import { describe, it, expect } from "vitest";
import {
  checkPlatformApiReconciliation,
  type ApiReachRow,
  type FactRow,
} from "../correctnessChecks";

// WEBDEV-288 Part B — platform-API reconciliation. Pure comparison of the stored
// canonical reach against the platform's raw per-day reach (Meta Graph: IG insights
// reach, FB page_total_media_view_unique proxy). Materiality-gated so it catches
// writer-class bugs (wrong metric / bad transform / zeroed column) while tolerating
// small platform restatements — see the 25%/abs-5 thresholds.

const fact = (o: Partial<FactRow>): FactRow => ({
  table: "account_daily_facts",
  platform: "instagram",
  date: "2026-06-10",
  reach: 100,
  impressions: null,
  followers: 500,
  engagement: 5,
  engagement_rate: 0.05,
  content_reach: 100,
  engagement_rate_followers: 0.01,
  is_post_day: true,
  ...o,
});
const api = (platform: string, date: string, reach: number | null): ApiReachRow => ({
  platform,
  date,
  reach,
});

describe("checkPlatformApiReconciliation", () => {
  it("passes when stored reach matches the API exactly", () => {
    const v = checkPlatformApiReconciliation(
      [fact({ platform: "instagram", date: "2026-06-10", reach: 100 })],
      [api("instagram", "2026-06-10", 100)],
    );
    expect(v).toHaveLength(0);
  });

  it("passes on a small divergence (platform restatement) below the materiality threshold", () => {
    // 103 vs 100 = 3% / abs 3 — both under 25% and under abs-5 → tolerated
    const v = checkPlatformApiReconciliation(
      [fact({ platform: "facebook", date: "2026-06-10", reach: 103 })],
      [api("facebook", "2026-06-10", 100)],
    );
    expect(v).toHaveLength(0);
  });

  it("FAILS when stored FB reach diverges materially from the API", () => {
    const v = checkPlatformApiReconciliation(
      [fact({ platform: "facebook", date: "2026-06-10", reach: 500 })],
      [api("facebook", "2026-06-10", 100)],
    );
    expect(v).toHaveLength(1);
    expect(v[0].check).toBe("platform-reconciliation");
    expect(v[0].severity).toBe("fail");
    expect(v[0].detail).toContain("facebook");
    expect(v[0].detail).toContain("2026-06-10");
  });

  it("FAILS when the writer zeroed a column the API says is populated", () => {
    const v = checkPlatformApiReconciliation(
      [fact({ platform: "instagram", date: "2026-06-10", reach: 0 })],
      [api("instagram", "2026-06-10", 240)],
    );
    expect(v).toHaveLength(1);
    expect(v[0].severity).toBe("fail");
  });

  it("skips rows whose stored reach is null (genuine/allowlisted absence — not ours to judge)", () => {
    const v = checkPlatformApiReconciliation(
      [fact({ platform: "instagram", date: "2026-06-10", reach: null })],
      [api("instagram", "2026-06-10", 240)],
    );
    expect(v).toHaveLength(0);
  });

  it("skips (platform,date) pairs the API has no value for (availability gap)", () => {
    const v = checkPlatformApiReconciliation(
      [fact({ platform: "facebook", date: "2026-06-10", reach: 9999 })],
      [api("facebook", "2026-06-09", 100)], // different date
    );
    expect(v).toHaveLength(0);
  });

  it("only reconciles facebook + instagram (ignores pinterest)", () => {
    const v = checkPlatformApiReconciliation(
      [fact({ platform: "pinterest", date: "2026-06-10", reach: 9999 })],
      [api("pinterest", "2026-06-10", 10)],
    );
    expect(v).toHaveLength(0);
  });

  it("does nothing when there are no API rows (no token / fetch skipped)", () => {
    const v = checkPlatformApiReconciliation(
      [fact({ platform: "instagram", date: "2026-06-10", reach: 100 })],
      [],
    );
    expect(v).toHaveLength(0);
  });
});
