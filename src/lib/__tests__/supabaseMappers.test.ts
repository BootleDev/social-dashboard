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
  mapAccountDailyFactsRow,
} from "../supabaseMappers";
import { num, hasRealReach, hasRealImpressions } from "../utils";
import { assertFractionScale } from "../rateSentinel";

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

// ===========================================================================
// mapAccountDailyFactsRow (WEBDEV-228) — the SOLE source for account KPIs.
// ===========================================================================
//
// Fixtures are REAL rows captured live 2026-06-20 from social.account_daily_facts
// and the matching Airtable "Account Daily Facts" records (same platform|date),
// so the offline-parity test below is ground truth, not a re-statement of the
// map. Numeric columns come back from pg as JS numbers; the `numeric`
// engagement_rate comes back as a STRING (no OID-1700 typeparser), so the
// fixtures model it as a string ("0.0860") exactly as the driver delivers it.

// A synthetic FULL row (every column non-null) to lock the exact emitted key set.
function fullAccountRow(overrides: Record<string, unknown> = {}) {
  return {
    snapshot_key: "instagram|2026-06-08",
    platform: "instagram",
    date: "2026-06-08",
    reach: 4000,
    reach_source: "daily_real",
    impressions: 5000,
    impressions_source: "daily_real",
    views: 10,
    views_source: "daily_real",
    profile_views: 300,
    followers: 1000,
    follower_delta: 12,
    engagement: 250,
    engagement_rate: "0.0860", // pg numeric -> string
    data_status: "settled",
    restatement_log: "restated 2026-06-08",
    profile_views_30d: 913,
    accounts_engaged_30d: 150,
    interactions_30d: 480,
    profile_links_taps_30d: 7,
    period_source: "period_aggregate",
    updated_at: "2026-06-08T03:00:00.000Z",
    ...overrides,
  };
}

describe("mapAccountDailyFactsRow — envelope shape", () => {
  it("emits the EXACT 1:1 Airtable display-name key set for a full row", () => {
    const rec = mapAccountDailyFactsRow(fullAccountRow());
    expect(Object.keys(rec.fields).sort()).toEqual(
      [
        "Snapshot Key",
        "Platform",
        "Date",
        "Reach",
        "Reach Source",
        "Impressions",
        "Impressions Source",
        "Views",
        "Views Source",
        "Profile Views",
        "Followers",
        "Follower Delta", // NOT "Followers Gained" (that is the legacy table)
        "Engagement",
        "Engagement Rate",
        "data_status", // snake_case literal — NOT title-case
        "Restatement Log",
        "Profile Views (30d)",
        "Accounts Engaged (30d)",
        "Interactions (30d)",
        "Profile Links Taps (30d)",
        "Period Source",
      ].sort(),
    );
  });

  it("synthesizes id as `platform|date` and createdTime from updated_at", () => {
    const rec = mapAccountDailyFactsRow(fullAccountRow());
    expect(rec.id).toBe("instagram|2026-06-08");
    expect(rec.createdTime).toBe("2026-06-08T03:00:00.000Z");
  });

  it("ENGAGEMENT RATE: passes the pg numeric STRING through verbatim (fraction, num(x)*100 = percent)", () => {
    const rec = mapAccountDailyFactsRow(fullAccountRow());
    const er = rec.fields["Engagement Rate"];
    expect(er).toBe("0.0860"); // unchanged string — no *100, no Number() coercion
    expect(num(er)).toBeCloseTo(0.086, 10);
    expect(num(er) * 100).toBeCloseTo(8.6, 10);
  });

  it("SPARSE SHAPE: null columns are OMITTED, a real 0 is KEPT", () => {
    const rec = mapAccountDailyFactsRow(
      fullAccountRow({
        impressions: null,
        restatement_log: null,
        profile_links_taps_30d: null,
        engagement: 0,
      }),
    );
    expect("Impressions" in rec.fields).toBe(false);
    expect("Restatement Log" in rec.fields).toBe(false);
    expect("Profile Links Taps (30d)" in rec.fields).toBe(false);
    expect(rec.fields["Engagement"]).toBe(0); // 0 is a real value, emitted
  });
});

describe("mapAccountDailyFactsRow — provenance / honesty model (hasRealReach/hasRealImpressions)", () => {
  // IG: account impressions retired by Meta -> impressions_source is the literal
  // STRING "null"; reach is a real same-day measurement (daily_real).
  const igRow = {
    snapshot_key: "instagram|2026-06-17",
    platform: "instagram",
    date: "2026-06-17",
    reach: 46,
    reach_source: "daily_real",
    impressions: null,
    impressions_source: "null",
    views_source: "null",
    followers: 732,
    follower_delta: 0,
    data_status: "settled",
    updated_at: "2026-06-20T00:19:33.990538+00:00",
  };
  // FB: reach became a page_total_media_view_unique PROXY on 2026-06-20, tagged
  // `daily_proxy` — which is NOT in REAL_PER_DAY_VOLUME_SOURCES, so FB reach is
  // (still) NOT summed into the account headline. Impressions are real.
  const fbRow = {
    snapshot_key: "facebook|2026-06-17",
    platform: "facebook",
    date: "2026-06-17",
    reach: 32,
    reach_source: "daily_proxy",
    impressions: 32,
    impressions_source: "daily_real",
    views_source: "null",
    profile_views: 1,
    followers: 83,
    follower_delta: 0,
    engagement: 0,
    data_status: "settled",
    updated_at: "2026-06-20T00:19:33.990538+00:00",
  };
  // Pinterest: account reach/impressions = the day's pin-impression SUM
  // (MARKETING-35), tagged `pin_sum` — real and summable.
  const pinRow = {
    snapshot_key: "pinterest|2026-06-16",
    platform: "pinterest",
    date: "2026-06-16",
    reach: 79,
    reach_source: "pin_sum",
    impressions: 79,
    impressions_source: "pin_sum",
    views_source: null, // SQL NULL on Pinterest (asymmetry vs FB/IG "null" string)
    followers: 5,
    follower_delta: null,
    engagement_rate: "0.0860",
    data_status: "settled",
    updated_at: "2026-06-19T05:40:28.710302+00:00",
  };

  it("IG: impressions_source literal string 'null' -> hasRealImpressions FALSE; daily_real reach -> hasRealReach TRUE", () => {
    const rec = mapAccountDailyFactsRow(igRow);
    expect(rec.fields["Impressions Source"]).toBe("null"); // string emitted, not dropped
    expect(hasRealImpressions(rec)).toBe(false);
    expect(hasRealReach(rec)).toBe(true);
  });

  it("FB: daily_proxy reach -> hasRealReach FALSE (proxy not summed); daily_real impressions -> hasRealImpressions TRUE", () => {
    const rec = mapAccountDailyFactsRow(fbRow);
    expect(rec.fields["Reach Source"]).toBe("daily_proxy");
    expect(hasRealReach(rec)).toBe(false);
    expect(hasRealImpressions(rec)).toBe(true);
  });

  it("Pinterest: pin_sum -> both real; SQL-NULL views_source OMITS the Views Source key (asymmetry vs FB/IG string 'null')", () => {
    const rec = mapAccountDailyFactsRow(pinRow);
    expect(hasRealReach(rec)).toBe(true);
    expect(hasRealImpressions(rec)).toBe(true);
    expect("Views Source" in rec.fields).toBe(false); // Pinterest: SQL NULL -> omitted
    expect("Follower Delta" in rec.fields).toBe(false); // null -> num(undefined)=0 downstream is intentional
  });

  it("NULL-SOURCE EDGE: reach_source=null -> NO 'Reach Source' key (sparse) AND hasRealReach TRUE (ER-Type fallback is intentionally dead for ADF)", () => {
    // Documents that the legacy ER-Type fallback in hasRealMetricSource never
    // fires for ADF rows: with no Source key and no ER Type, it defaults to real.
    // (No live ADF row has a null reach_source today — this is a defensive guard.)
    const rec = mapAccountDailyFactsRow({ ...igRow, reach_source: null });
    expect("Reach Source" in rec.fields).toBe(false);
    expect(hasRealReach(rec)).toBe(true);
  });

  it("PERIOD_AGGREGATE: the IG rolling-30d row carries reach_source='daily_real' so it IS summed (matches Airtable) — Period Source only routes the 30d tiles", () => {
    const rec = mapAccountDailyFactsRow({
      ...igRow,
      reach_source: "daily_real",
      period_source: "period_aggregate",
      profile_views_30d: 927,
    });
    // A future reviewer must NOT "fix" this to exclude it: parity requires it.
    expect(rec.fields["Reach Source"]).toBe("daily_real");
    expect(hasRealReach(rec)).toBe(true);
    expect(rec.fields["Period Source"]).toBe("period_aggregate");
    expect(rec.fields["Profile Views (30d)"]).toBe(927);
  });
});

describe("mapAccountDailyFactsRow — unit sentinel (#1 risk) on raw rows", () => {
  it("a fraction-scale engagement_rate passes the sentinel", () => {
    expect(() =>
      assertFractionScale("social.account_daily_facts", [fullAccountRow()], {
        throwOn: ["engagement_rate"],
        idCols: ["platform", "date"],
      }),
    ).not.toThrow();
  });

  it("REGRESSION GUARD: a percent-scale engagement_rate (8.6) THROWS, failing the read over to Airtable", () => {
    expect(() =>
      assertFractionScale(
        "social.account_daily_facts",
        [fullAccountRow({ engagement_rate: "8.6" })],
        { throwOn: ["engagement_rate"], idCols: ["platform", "date"] },
      ),
    ).toThrow(/engagement_rate/);
  });
});

describe("mapAccountDailyFactsRow — OFFLINE PARITY vs live Airtable (the silent-key-mismatch backstop)", () => {
  // Each pair was captured at the same instant (2026-06-20) for the same
  // platform|date. A silent display-name typo in the map returns wrong-key rows
  // that fail-closed CANNOT catch (not empty, no throw) -> every KPI blanks.
  // This asserts byte-for-byte field parity against ground truth.
  type Pair = {
    label: string;
    supabaseRow: Record<string, unknown>;
    airtableFields: Record<string, unknown>;
  };

  const pairs: Pair[] = [
    {
      label: "facebook|2026-06-17 (settled, daily_proxy reach)",
      supabaseRow: {
        snapshot_key: "facebook|2026-06-17",
        platform: "facebook",
        date: "2026-06-17",
        reach: 32,
        reach_source: "daily_proxy",
        impressions: 32,
        impressions_source: "daily_real",
        views: null,
        views_source: "null",
        profile_views: 1,
        followers: 83,
        follower_delta: 0,
        engagement: 0,
        engagement_rate: null,
        data_status: "settled",
        restatement_log: null,
        period_source: null,
        profile_views_30d: null,
        accounts_engaged_30d: null,
        interactions_30d: null,
        profile_links_taps_30d: null,
        updated_at: "2026-06-20T00:19:33.990538+00:00",
      },
      airtableFields: {
        "Views Source": "null",
        Platform: "facebook",
        Reach: 32,
        "Reach Source": "daily_proxy",
        "Profile Views": 1,
        "Impressions Source": "daily_real",
        data_status: "settled",
        Date: "2026-06-17",
        Engagement: 0,
        "Snapshot Key": "facebook|2026-06-17",
        Followers: 83,
        "Follower Delta": 0,
        Impressions: 32,
      },
    },
    {
      label: "pinterest|2026-06-16 (settled, pin_sum, SQL-NULL views_source)",
      supabaseRow: {
        snapshot_key: "pinterest|2026-06-16",
        platform: "pinterest",
        date: "2026-06-16",
        reach: 79,
        reach_source: "pin_sum",
        impressions: 79,
        impressions_source: "pin_sum",
        views: null,
        views_source: null,
        profile_views: null,
        followers: 5,
        follower_delta: null,
        engagement: null,
        engagement_rate: "0.0860", // Airtable keeps full float; pg rounds to scale
        data_status: "settled",
        restatement_log: null,
        period_source: null,
        profile_views_30d: null,
        accounts_engaged_30d: null,
        interactions_30d: null,
        profile_links_taps_30d: null,
        updated_at: "2026-06-19T05:40:28.710302+00:00",
      },
      airtableFields: {
        Platform: "pinterest",
        Reach: 79,
        "Reach Source": "pin_sum",
        "Impressions Source": "pin_sum",
        data_status: "settled",
        Date: "2026-06-16",
        "Engagement Rate": 0.08602150537634409,
        "Snapshot Key": "pinterest|2026-06-16",
        Followers: 5,
        Impressions: 79,
      },
    },
    {
      label: "instagram|2026-06-19 (period_aggregate, 30d tiles)",
      supabaseRow: {
        snapshot_key: "instagram|2026-06-19",
        platform: "instagram",
        date: "2026-06-19",
        reach: 116,
        reach_source: "daily_real",
        impressions: null,
        impressions_source: "null",
        views: null,
        views_source: "null",
        profile_views: null,
        followers: 732,
        follower_delta: 0,
        engagement: 0,
        engagement_rate: "0", // pg numeric 0
        data_status: "pending",
        restatement_log: null,
        period_source: "period_aggregate",
        profile_views_30d: 927,
        accounts_engaged_30d: 148,
        interactions_30d: 488,
        profile_links_taps_30d: null,
        updated_at: "2026-06-20T00:19:33.990538+00:00",
      },
      airtableFields: {
        "Views Source": "null",
        Platform: "instagram",
        Reach: 116,
        "Reach Source": "daily_real",
        "Impressions Source": "null",
        data_status: "pending",
        Date: "2026-06-19",
        "Profile Views (30d)": 927,
        "Engagement Rate": 0,
        Engagement: 0,
        "Snapshot Key": "instagram|2026-06-19",
        "Interactions (30d)": 488,
        "Period Source": "period_aggregate",
        Followers: 732,
        "Accounts Engaged (30d)": 148,
        "Follower Delta": 0,
      },
    },
  ];

  for (const { label, supabaseRow, airtableFields } of pairs) {
    it(`emits a byte-for-byte identical field envelope for ${label}`, () => {
      const mapped = mapAccountDailyFactsRow(supabaseRow).fields;

      // 1. Same key SET (the silent-mismatch killer). Snapshot Key included.
      expect(Object.keys(mapped).sort()).toEqual(
        Object.keys(airtableFields).sort(),
      );

      // 2. Same VALUE per key. Engagement Rate diverges only by pg's numeric
      //    rounding (Airtable keeps the full float) — identical when rendered,
      //    so compare it numerically; everything else must be strictly equal.
      for (const key of Object.keys(airtableFields)) {
        if (key === "Engagement Rate") {
          expect(num(mapped[key])).toBeCloseTo(num(airtableFields[key]), 3);
        } else {
          expect(mapped[key]).toEqual(airtableFields[key]);
        }
      }
    });
  }
});
