import { describe, it, expect } from "vitest";
import {
  checkFreshness,
  checkEngagementRateRange,
  checkNonNegative,
  checkNoInteriorGaps,
  checkCoreNonNull,
  checkEngagementRateReproducible,
  checkErfReproducible,
  checkNullSymmetry,
  checkIsPostDayConsistency,
  enumerateDates,
  runAllChecks,
  ALLOWLIST,
  checkPlatformCoverage,
  checkPlatformFreshness,
  checkWindowFor,
  settleDaysFor,
  DEFAULT_SETTLE_DAYS,
  type FactRow,
} from "../correctnessChecks";

const fact = (o: Partial<FactRow>): FactRow => ({
  table: "account_daily_facts", platform: "pinterest", date: "2026-06-10",
  reach: 10, impressions: 10, followers: 5, engagement: 1, engagement_rate: 0.1,
  content_reach: 10, engagement_rate_followers: 0.2, is_post_day: true, ...o,
});
// A FB/IG row (the new content-grain invariants are scoped to facebook + instagram).
const fbig = (o: Partial<FactRow>): FactRow => fact({ platform: "instagram", ...o });

describe("checkFreshness", () => {
  it("fails a stale table and a no-rows table, passes a fresh one", () => {
    const v = checkFreshness(
      [{ table: "a", ageHours: 10 }, { table: "b", ageHours: 80 }, { table: "c", ageHours: null }],
      { a: 48, b: 48, c: 48 },
    );
    expect(v.map((x) => x.detail.split(":")[0])).toEqual(["b", "c"]);
    expect(v.every((x) => x.severity === "fail")).toBe(true);
  });
  it("honours per-table windows (weekly tables get a longer limit)", () => {
    const v = checkFreshness([{ table: "weekly_summaries", ageHours: 100 }], { weekly_summaries: 192 });
    expect(v).toEqual([]);
  });
});

describe("checkEngagementRateRange", () => {
  it("fails ER outside [0,1], passes in-range and null", () => {
    const v = checkEngagementRateRange([
      fact({ engagement_rate: 1.5 }), fact({ engagement_rate: -0.1 }),
      fact({ engagement_rate: 0.5 }), fact({ engagement_rate: null }),
    ]);
    expect(v).toHaveLength(2);
  });
});

describe("checkNonNegative", () => {
  it("fails a negative count, ignores nulls", () => {
    const v = checkNonNegative([fact({ reach: -1 }), fact({ followers: null }), fact({ impressions: 0 })]);
    expect(v).toHaveLength(1);
    expect(v[0].detail).toContain("reach=-1");
  });
  it("catches a negative content_reach (else the ER check skips content_reach<=0)", () => {
    const v = checkNonNegative([fact({ content_reach: -50 })]);
    expect(v).toHaveLength(1);
    expect(v[0].detail).toContain("content_reach=-50");
  });
});

describe("checkNoInteriorGaps", () => {
  it("fails a missing interior date", () => {
    const rows = [fact({ date: "2026-06-10" }), fact({ date: "2026-06-12" })]; // 06-11 missing
    const v = checkNoInteriorGaps(rows, ["pinterest"]);
    expect(v).toHaveLength(1);
    expect(v[0].detail).toContain("pinterest|2026-06-11");
  });
  it("does NOT fail on trailing lag (a shorter contiguous range)", () => {
    const rows = [fact({ date: "2026-06-10" }), fact({ date: "2026-06-11" }), fact({ date: "2026-06-12" })];
    expect(checkNoInteriorGaps(rows, ["pinterest"])).toEqual([]);
  });
});

describe("checkCoreNonNull", () => {
  it("fails null reach or followers", () => {
    const v = checkCoreNonNull([fact({ reach: null }), fact({ followers: null }), fact({})]);
    expect(v).toHaveLength(2);
  });

  // WEBDEV-535: TikTok has no account-level reach at the source (ScrapeCreators profile =
  // followers only), so a NULL there is honest, not a dead writer.
  it("does NOT fail null reach on tiktok (structurally unavailable — allowlisted)", () => {
    expect(checkCoreNonNull([fact({ platform: "tiktok", reach: null })])).toEqual([]);
  });

  // The exemption must be surgical: it buys silence on reach ONLY, and only for tiktok.
  it("STILL fails null followers on tiktok (a dead TikTok writer must not go silent)", () => {
    const v = checkCoreNonNull([fact({ platform: "tiktok", reach: null, followers: null })]);
    expect(v).toHaveLength(1);
    expect(v[0].detail).toContain("followers NULL at tiktok");
  });

  it("still fails null reach on every non-exempt platform", () => {
    const v = checkCoreNonNull([
      fact({ platform: "instagram", reach: null }),
      fact({ platform: "facebook", reach: null }),
      fact({ platform: "pinterest", reach: null }),
    ]);
    expect(v).toHaveLength(3);
    expect(v.every((x) => x.check === "core-null" && x.severity === "fail")).toBe(true);
  });

  it("the tiktok reach exemption is backed by a reasoned ALLOWLIST entry", () => {
    const entry = ALLOWLIST.find(
      (a) => a.table === "account_daily_facts" && a.platform === "tiktok" && a.metric === "reach",
    );
    expect(entry).toBeDefined();
    expect(entry!.reason).toBeTruthy();
  });
});

describe("WEBDEV-536: per-platform settle windows", () => {
  it("IG's checked band sits PAST its 21d settle window (the old fixed 3-16d band could never contain a settled IG row)", () => {
    const ig = checkWindowFor("instagram");
    expect(ig.minAgeDays).toBe(22); // settled only at age > 21
    expect(ig.maxAgeDays).toBe(35);
    // The regression itself: the old band's ceiling was 16 days, below IG's floor of 22.
    expect(ig.minAgeDays).toBeGreaterThan(16);
  });

  it("fast-settling platforms keep a near-term band", () => {
    expect(checkWindowFor("facebook")).toEqual({ minAgeDays: 4, maxAgeDays: 17 });
    expect(checkWindowFor("tiktok")).toEqual({ minAgeDays: 4, maxAgeDays: 17 });
  });

  it("an unknown/new platform falls back to the default settle window rather than vanishing", () => {
    expect(settleDaysFor("threads")).toBe(DEFAULT_SETTLE_DAYS);
    expect(checkWindowFor("threads")).toEqual({ minAgeDays: 4, maxAgeDays: 17 });
  });
});

describe("checkPlatformCoverage (WEBDEV-536 — the guard that catches a blind monitor)", () => {
  it("REPRODUCES WEBDEV-536: a live platform contributing zero checked rows fails LOUD", () => {
    // Exactly the production state: IG live in the table, but no IG row in the checked window.
    const v = checkPlatformCoverage(
      ["facebook", "instagram", "pinterest", "tiktok"],
      [fact({ platform: "facebook" }), fact({ platform: "pinterest" }), fact({ platform: "tiktok" })],
    );
    expect(v).toHaveLength(1);
    expect(v[0].check).toBe("coverage");
    expect(v[0].severity).toBe("fail");
    expect(v[0].detail).toContain("instagram");
    expect(v[0].detail).toContain("BLIND");
  });

  it("passes when every live platform contributes rows", () => {
    const v = checkPlatformCoverage(
      ["facebook", "instagram"],
      [fact({ platform: "facebook" }), fact({ platform: "instagram" })],
    );
    expect(v).toEqual([]);
  });

  it("does not alarm on a platform that is no longer live in the table", () => {
    expect(checkPlatformCoverage([], [])).toEqual([]);
  });
});

describe("checkPlatformFreshness (WEBDEV-536 — catches a dead writer that table-level freshness cannot)", () => {
  it("fails a single stale platform even while the TABLE stays fresh via its other writers", () => {
    const v = checkPlatformFreshness([
      { platform: "instagram", ageHours: 5 },
      { platform: "facebook", ageHours: 5 },
      { platform: "pinterest", ageHours: 5 },
      { platform: "tiktok", ageHours: 300 }, // dead TikTok writer; the other 3 keep the table fresh
    ]);
    expect(v).toHaveLength(1);
    expect(v[0].check).toBe("platform-freshness");
    expect(v[0].detail).toContain("tiktok");
  });

  it("fails a platform with no rows at all, and passes healthy ones", () => {
    const v = checkPlatformFreshness([
      { platform: "tiktok", ageHours: null },
      { platform: "facebook", ageHours: 10 },
    ]);
    expect(v).toHaveLength(1);
    expect(v[0].detail).toContain("no rows at all");
  });
});

describe("checkEngagementRateReproducible (WEBDEV-295/296, FB+IG)", () => {
  it("passes when engagement_rate == round(engagement/content_reach, 4)", () => {
    // 28/1339 = 0.020911… -> 0.0209
    expect(checkEngagementRateReproducible([fbig({ engagement: 28, content_reach: 1339, engagement_rate: 0.0209 })])).toEqual([]);
  });
  it("fails when engagement_rate disagrees at 4dp", () => {
    const v = checkEngagementRateReproducible([fbig({ engagement: 28, content_reach: 1322, engagement_rate: 0.0210 })]); // expect 0.0212
    expect(v).toHaveLength(1);
    expect(v[0].severity).toBe("fail");
  });
  it("skips no-post rows (null), content_reach=0 degenerate, and pinterest", () => {
    expect(checkEngagementRateReproducible([
      fbig({ engagement: null, content_reach: null, engagement_rate: null }),
      fbig({ engagement: 5, content_reach: 0, engagement_rate: null }),
      fact({ platform: "pinterest", engagement: 9, content_reach: null, engagement_rate: 0.99 }),
    ])).toEqual([]);
  });
});

describe("checkErfReproducible (FB+IG)", () => {
  it("passes when ERF == round(engagement/followers, 4)", () => {
    // 28/743 = 0.037685… -> 0.0377
    expect(checkErfReproducible([fbig({ engagement: 28, followers: 743, engagement_rate_followers: 0.0377 })])).toEqual([]);
  });
  it("fails when ERF disagrees at 4dp", () => {
    const v = checkErfReproducible([fbig({ engagement: 28, followers: 743, engagement_rate_followers: 0.0378 })]);
    expect(v).toHaveLength(1);
  });
  it("skips when ERF null (follower-fetch gap) — ERF is not strictly required", () => {
    expect(checkErfReproducible([fbig({ engagement: 28, followers: 743, engagement_rate_followers: null })])).toEqual([]);
  });
});

describe("checkNullSymmetry (FB+IG)", () => {
  it("passes a clean post-day and a clean no-post day", () => {
    expect(checkNullSymmetry([
      fbig({ engagement: 10, content_reach: 100, engagement_rate: 0.1 }),
      fbig({ engagement: null, content_reach: null, engagement_rate: null }),
    ])).toEqual([]);
  });
  it("fails engagement/content_reach disagreement", () => {
    expect(checkNullSymmetry([fbig({ engagement: 10, content_reach: null, engagement_rate: null })])).toHaveLength(1);
  });
  it("fails engagement_rate disagreement, but EXEMPTS the content_reach=0 degenerate", () => {
    expect(checkNullSymmetry([fbig({ engagement: 10, content_reach: 100, engagement_rate: null })])).toHaveLength(1);
    expect(checkNullSymmetry([fbig({ engagement: 10, content_reach: 0, engagement_rate: null })])).toEqual([]);
  });
});

describe("checkIsPostDayConsistency (FB+IG)", () => {
  it("passes is_post_day == (engagement IS NOT NULL)", () => {
    expect(checkIsPostDayConsistency([
      fbig({ engagement: 10, is_post_day: true }),
      fbig({ engagement: null, is_post_day: false }),
    ])).toEqual([]);
  });
  it("fails a no-post day flagged as a post day (engagement=0 stale)", () => {
    expect(checkIsPostDayConsistency([fbig({ engagement: 0, is_post_day: false })])).toHaveLength(1);
    expect(checkIsPostDayConsistency([fbig({ engagement: null, is_post_day: true })])).toHaveLength(1);
  });
});

describe("enumerateDates", () => {
  it("is inclusive and contiguous across a month boundary", () => {
    expect(enumerateDates("2026-05-30", "2026-06-02")).toEqual(["2026-05-30", "2026-05-31", "2026-06-01", "2026-06-02"]);
  });
});

describe("runAllChecks", () => {
  it("returns no violations for clean input", () => {
    const facts = [fact({ date: "2026-06-10" }), fact({ date: "2026-06-11" })];
    const v = runAllChecks({
      freshness: [{ table: "account_daily_facts", ageHours: 5 }],
      facts,
      freshnessMaxAgeHours: { account_daily_facts: 48 },
      platforms: ["pinterest"],
    });
    expect(v).toEqual([]);
  });
});
