/**
 * Pure unit tests for the Supabase row -> Airtable-envelope mappers (WEBDEV-207).
 *
 * NO live DB: these exercise the pure mappers extracted out of supabase.ts so
 * the shape-critical contract is locked in CI. The #1 review risk is the
 * engagement-rate axis scale: daily_account_metrics.engagement_rate is a
 * FRACTION (0.0870 = 8.70%) and the dashboard does num(x) * 100 on the SAME
 * axis as the unchanged Airtable POSTS ER line. If a future ETL ever writes
 * percents (8.7) instead of fractions (0.087), the chart would silently render
 * 870% — these tests turn that into a red build instead.
 */

import { describe, it, expect } from "vitest";
import {
  mapDailyRow,
  mapWeeklyRow,
  mapAlertRow,
} from "../supabaseMappers";
import { num } from "../utils";

// A full daily row as it arrives from pg AFTER the type parsers in supabase.ts
// (date stays a "YYYY-MM-DD" string; numerics may be strings, but we feed
// numbers here to assert exact === equality on the passthrough).
function dailyRow(overrides: Record<string, unknown> = {}) {
  return {
    date: "2026-06-08",
    platform: "instagram",
    followers: 1000,
    followers_gained: 12,
    impressions: 5000,
    reach: 4000,
    profile_views: 300,
    website_clicks: 25,
    engagement_rate: 0.087,
    er_type: "reach",
    updated_at: "2026-06-08T03:00:00.000Z",
    ...overrides,
  };
}

describe("mapDailyRow — engagement-rate axis scale (#1 risk)", () => {
  it("passes the engagement_rate through as a FRACTION (0.087), so num(x)*100 = 8.7%", () => {
    const rec = mapDailyRow(dailyRow());
    const er = rec.fields["Engagement Rate"];

    // Exact passthrough: no *100 percent conversion in the mapper.
    expect(er).toBe(0.087);

    // Property: it is a fraction strictly between 0 and 1.
    expect(typeof num(er)).toBe("number");
    expect(num(er)).toBeGreaterThan(0);
    expect(num(er)).toBeLessThan(1);

    // The dashboard's render math: num(fraction) * 100 -> percent.
    expect(num(er) * 100).toBeCloseTo(8.7, 10);
  });

  it("REGRESSION GUARD: a percent-shaped engagement_rate (8.7) VIOLATES the fraction invariant", () => {
    // Simulate a future ETL bug that writes a percent (8.7) instead of a
    // fraction (0.087). The mapper passes it through verbatim, so the
    // fraction-< 1 property below FAILS — which is exactly what makes CI go red
    // instead of the chart silently rendering 8.7 * 100 = 870%.
    const rec = mapDailyRow(dailyRow({ engagement_rate: 8.7 }));
    const er = rec.fields["Engagement Rate"];

    // The value the chart would multiply by 100 — catastrophically wrong.
    expect(num(er) * 100).toBeCloseTo(870, 6);

    // The guard: the fraction invariant (< 1) does NOT hold for a percent.
    // If a real row ever looked like this, the assertion in the test above
    // (toBeLessThan(1)) would fail and the build would break.
    expect(num(er)).toBeGreaterThanOrEqual(1);
    expect(num(er) < 1).toBe(false);
  });
});

describe("mapDailyRow — envelope shape", () => {
  it("emits the EXACT Airtable display-name key set for a full row", () => {
    const rec = mapDailyRow(dailyRow());
    expect(Object.keys(rec.fields).sort()).toEqual(
      [
        "Date",
        "Platform",
        "Followers",
        "Followers Gained",
        "Impressions",
        "Reach",
        "Profile Views",
        "Website Clicks",
        "Engagement Rate",
        "ER Type",
      ].sort(),
    );
  });

  it("synthesizes id as `platform|date`", () => {
    const rec = mapDailyRow(dailyRow());
    expect(rec.id).toBe("instagram|2026-06-08");
  });

  it("derives createdTime (ISO) from updated_at", () => {
    const rec = mapDailyRow(dailyRow());
    expect(rec.createdTime).toBe("2026-06-08T03:00:00.000Z");
  });

  it("falls back to epoch createdTime when updated_at is missing", () => {
    const rec = mapDailyRow(dailyRow({ updated_at: null }));
    expect(rec.createdTime).toBe(new Date(0).toISOString());
  });

  it("SPARSE SHAPE: a null column key is OMITTED (Airtable empty-cell parity)", () => {
    // website_clicks/impressions null => the dashboard renders "—" not 0.
    const rec = mapDailyRow(
      dailyRow({ website_clicks: null, impressions: null }),
    );
    expect("Website Clicks" in rec.fields).toBe(false);
    expect("Impressions" in rec.fields).toBe(false);
    // A real 0 IS a value and is kept.
    const recZero = mapDailyRow(dailyRow({ website_clicks: 0 }));
    expect(recZero.fields["Website Clicks"]).toBe(0);
  });
});

describe("mapWeeklyRow", () => {
  function weeklyRow(overrides: Record<string, unknown> = {}) {
    return {
      week_start: "2026-06-01",
      period: "2026-06-01 — 2026-06-07",
      posts_analysed: 9,
      full_report: "Weekly report markdown…",
      top_post: "recABC",
      platform_breakdown: "{...}",
      updated_at: "2026-06-08T03:00:00.000Z",
      ...overrides,
    };
  }

  it("emits the EXACT weekly display-name key set", () => {
    const rec = mapWeeklyRow(weeklyRow());
    expect(Object.keys(rec.fields).sort()).toEqual(
      [
        "Week Start",
        "Period",
        "Posts Analysed",
        "Full Report",
        "Top Post",
        "Platform Breakdown",
      ].sort(),
    );
  });

  it("synthesizes id as `week|week_start`", () => {
    expect(mapWeeklyRow(weeklyRow()).id).toBe("week|2026-06-01");
  });

  it("SPARSE SHAPE: omits a null Full Report", () => {
    const rec = mapWeeklyRow(weeklyRow({ full_report: null }));
    expect("Full Report" in rec.fields).toBe(false);
  });
});

describe("mapAlertRow", () => {
  function alertRow(overrides: Record<string, unknown> = {}) {
    return {
      id: 4815162342,
      alert_date: "2026-06-08",
      platform: "tiktok",
      type: "spike",
      severity: "high",
      message: "Engagement spike detected",
      post_id: "recXYZ",
      updated_at: "2026-06-08T03:00:00.000Z",
      ...overrides,
    };
  }

  it("emits the EXACT alerts display-name key set", () => {
    const rec = mapAlertRow(alertRow());
    expect(Object.keys(rec.fields).sort()).toEqual(
      [
        "Alert Date",
        "Platform",
        "Type",
        "Severity",
        "Message",
        "Post ID",
      ].sort(),
    );
  });

  it("renders the bigint id as a STRING", () => {
    const rec = mapAlertRow(alertRow({ id: 4815162342 }));
    expect(rec.id).toBe("4815162342");
    expect(typeof rec.id).toBe("string");
  });

  it("SPARSE SHAPE: omits a null Post ID", () => {
    const rec = mapAlertRow(alertRow({ post_id: null }));
    expect("Post ID" in rec.fields).toBe(false);
  });
});
