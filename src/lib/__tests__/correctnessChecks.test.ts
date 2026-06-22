import { describe, it, expect } from "vitest";
import {
  checkFreshness,
  checkEngagementRateRange,
  checkNonNegative,
  checkNoInteriorGaps,
  checkCoreNonNull,
  enumerateDates,
  runAllChecks,
  type FactRow,
} from "../correctnessChecks";

const fact = (o: Partial<FactRow>): FactRow => ({
  table: "account_daily_facts", platform: "pinterest", date: "2026-06-10",
  reach: 10, impressions: 10, followers: 5, engagement: 1, engagement_rate: 0.1, ...o,
});

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
