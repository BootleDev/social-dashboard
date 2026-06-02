import { describe, it, expect } from "vitest";
import {
  num,
  count,
  hasRealAccountVolume,
  str,
  formatNumber,
  formatPercent,
  pctChange,
  avgERByPostType,
  avgERByTheme,
  postingHeatmap,
  splitByPlatform,
  groupByPlatform,
  getPlatformKeys,
  topPosts,
  sumField,
  avgField,
  buildUnifiedDates,
  getComparisonPeriod,
  hashtagFrequency,
  alignToDateArray,
  alignToDateArrayNullable,
  groupByDimension,
  timeBucket,
  dayOfWeek,
  avgERByDimensionStacked,
  sumByDimensionStacked,
  recordReach,
  sumReach,
} from "../utils";
import type { AirtableRecord } from "../utils";

function makeRecord(fields: Record<string, unknown>): AirtableRecord {
  return {
    id: `rec_${Math.random()}`,
    fields,
    createdTime: "2026-01-01T00:00:00.000Z",
  };
}

// --- num ---
describe("num", () => {
  it("returns number as-is", () => {
    expect(num(42)).toBe(42);
  });
  it("parses numeric string", () => {
    expect(num("3.14")).toBe(3.14);
  });
  it("returns 0 for non-numeric string", () => {
    expect(num("abc")).toBe(0);
  });
  it("returns 0 for null/undefined", () => {
    expect(num(null)).toBe(0);
    expect(num(undefined)).toBe(0);
  });
  it("returns 0 for boolean", () => {
    expect(num(true)).toBe(0);
  });
  it("returns 0 for non-finite number (Infinity / NaN)", () => {
    expect(num(Infinity)).toBe(0);
    expect(num(-Infinity)).toBe(0);
    expect(num(NaN)).toBe(0);
  });
  it("returns 0 for a string that parses to non-finite", () => {
    expect(num("Infinity")).toBe(0);
    expect(num("1e999")).toBe(0); // overflows to Infinity
  });
  it("passes negative values through (signed fields are legitimate)", () => {
    expect(num(-5)).toBe(-5);
    expect(num("-2.5")).toBe(-2.5);
  });
});

// --- count (non-negative integer tallies: reach, engagement, impressions) ---
describe("count", () => {
  it("returns a positive integer unchanged", () => {
    expect(count(371)).toBe(371);
  });
  it("floors a fractional value (tallies can't be fractional)", () => {
    expect(count(12.9)).toBe(12);
    expect(count("8.7")).toBe(8);
  });
  it("clamps negatives to 0 (a negative tally is a data error)", () => {
    expect(count(-5)).toBe(0);
    expect(count("-100")).toBe(0);
  });
  it("returns 0 for non-finite input", () => {
    expect(count(Infinity)).toBe(0);
    expect(count(NaN)).toBe(0);
    expect(count("Infinity")).toBe(0);
  });
  it("returns 0 for null/undefined/non-numeric", () => {
    expect(count(null)).toBe(0);
    expect(count(undefined)).toBe(0);
    expect(count("abc")).toBe(0);
  });
});

// --- hasRealAccountVolume (provenance guard for derived IG daily rows) ---
describe("hasRealAccountVolume", () => {
  it("treats a real same-day measurement (ER Type 'daily') as real", () => {
    expect(hasRealAccountVolume(makeRecord({ "ER Type": "daily" }))).toBe(true);
  });
  it("excludes derived rows (posts_derived_daily / period_average)", () => {
    expect(
      hasRealAccountVolume(makeRecord({ "ER Type": "posts_derived_daily" })),
    ).toBe(false);
    expect(
      hasRealAccountVolume(makeRecord({ "ER Type": "period_average" })),
    ).toBe(false);
  });
  it("treats a row with no ER Type as real (legacy rows predate tagging)", () => {
    expect(hasRealAccountVolume(makeRecord({ Impressions: 100 }))).toBe(true);
    expect(hasRealAccountVolume(makeRecord({ "ER Type": "" }))).toBe(true);
  });

  // WEBDEV-146: daily-facts rows carry explicit per-metric Source columns
  // instead of the overloaded ER Type. When a Source column is present it is
  // authoritative; ER Type is only consulted for legacy Daily Account Metrics
  // rows that have no Source columns.
  it("counts a fact row as real when a volume Source is daily_real", () => {
    expect(
      hasRealAccountVolume(
        makeRecord({ "Reach Source": "daily_real", "Impressions Source": "null" }),
      ),
    ).toBe(true);
    expect(
      hasRealAccountVolume(
        makeRecord({ "Reach Source": "null", "Impressions Source": "daily_real" }),
      ),
    ).toBe(true);
  });
  it("excludes a fact row whose volume Sources are all null (honestly absent)", () => {
    expect(
      hasRealAccountVolume(
        makeRecord({ "Reach Source": "null", "Impressions Source": "null" }),
      ),
    ).toBe(false);
  });
  it("ignores period_aggregate Sources when judging per-day volume", () => {
    // A period_aggregate value is a labelled 30d total, never a per-day measure;
    // it must not make a row count as real per-day volume.
    expect(
      hasRealAccountVolume(
        makeRecord({
          "Reach Source": "null",
          "Impressions Source": "null",
          "Period Source": "period_aggregate",
        }),
      ),
    ).toBe(false);
  });
  it("prefers Source columns over ER Type when both are present", () => {
    // A fact row that somehow also carries a legacy ER Type is judged by its
    // Source columns, not the stale flag.
    expect(
      hasRealAccountVolume(
        makeRecord({
          "Reach Source": "daily_real",
          "Impressions Source": "null",
          "ER Type": "period_average",
        }),
      ),
    ).toBe(true);
  });
});

// --- str ---
describe("str", () => {
  it("returns string as-is", () => {
    expect(str("hello")).toBe("hello");
  });
  it("converts number to string", () => {
    expect(str(42)).toBe("42");
  });
  it("returns empty string for null/undefined", () => {
    expect(str(null)).toBe("");
    expect(str(undefined)).toBe("");
  });
});

// --- formatNumber ---
describe("formatNumber", () => {
  it("formats millions", () => {
    expect(formatNumber(1_500_000)).toBe("1.5M");
  });
  it("formats thousands", () => {
    expect(formatNumber(2_500)).toBe("2.5K");
  });
  it("formats small numbers", () => {
    expect(formatNumber(42)).toBe("42");
  });
  it("formats zero", () => {
    expect(formatNumber(0)).toBe("0");
  });
  it("formats exactly 1000", () => {
    expect(formatNumber(1000)).toBe("1.0K");
  });
});

// --- formatPercent ---
describe("formatPercent", () => {
  it("formats with default 1 decimal", () => {
    expect(formatPercent(3.456)).toBe("3.5%");
  });
  it("formats with custom decimals", () => {
    expect(formatPercent(3.456, 2)).toBe("3.46%");
  });
  it("formats zero", () => {
    expect(formatPercent(0)).toBe("0.0%");
  });
});

// --- pctChange ---
describe("pctChange", () => {
  it("calculates positive change", () => {
    expect(pctChange(150, 100)).toBe(50);
  });
  it("calculates negative change", () => {
    expect(pctChange(50, 100)).toBe(-50);
  });
  it("returns undefined when previous is 0", () => {
    expect(pctChange(100, 0)).toBeUndefined();
  });
  it("returns 0 when values are equal", () => {
    expect(pctChange(100, 100)).toBe(0);
  });
});

// --- avgERByPostType ---
describe("avgERByPostType", () => {
  it("groups by post type and calculates avg ER", () => {
    const posts = [
      makeRecord({ "Post Type": "reel", "Engagement Rate": 5 }),
      makeRecord({ "Post Type": "reel", "Engagement Rate": 3 }),
      makeRecord({ "Post Type": "image", "Engagement Rate": 2 }),
    ];
    const result = avgERByPostType(posts);
    expect(result).toHaveLength(2);
    const reel = result.find((r) => r.type === "reel");
    expect(reel?.avgER).toBe(4);
    expect(reel?.count).toBe(2);
  });

  it("handles empty array", () => {
    expect(avgERByPostType([])).toEqual([]);
  });

  it("uses 'unknown' for missing post type", () => {
    const posts = [makeRecord({ "Engagement Rate": 5 })];
    const result = avgERByPostType(posts);
    expect(result[0].type).toBe("unknown");
  });

  it("sorts by avgER descending", () => {
    const posts = [
      makeRecord({ "Post Type": "image", "Engagement Rate": 1 }),
      makeRecord({ "Post Type": "reel", "Engagement Rate": 10 }),
    ];
    const result = avgERByPostType(posts);
    expect(result[0].type).toBe("reel");
  });
});

// --- avgERByTheme ---
describe("avgERByTheme", () => {
  it("groups by theme and calculates avg ER", () => {
    const posts = [
      makeRecord({ "Content Theme": "sustainability", "Engagement Rate": 4 }),
      makeRecord({ "Content Theme": "sustainability", "Engagement Rate": 6 }),
      makeRecord({ "Content Theme": "lifestyle", "Engagement Rate": 3 }),
    ];
    const result = avgERByTheme(posts);
    const sust = result.find((r) => r.theme === "sustainability");
    expect(sust?.avgER).toBe(5);
    expect(sust?.count).toBe(2);
  });

  it("uses 'untagged' for missing theme", () => {
    const posts = [makeRecord({ "Engagement Rate": 5 })];
    expect(avgERByTheme(posts)[0].theme).toBe("untagged");
  });
});

// --- avgERByDimensionStacked ---
describe("avgERByDimensionStacked", () => {
  const posts = [
    makeRecord({ "Post Type": "reel", "Content Theme": "Lifestyle", "Engagement Rate": 4 }),
    makeRecord({ "Post Type": "reel", "Content Theme": "Lifestyle", "Engagement Rate": 6 }),
    makeRecord({ "Post Type": "reel", "Content Theme": "Product", "Engagement Rate": 2 }),
    makeRecord({ "Post Type": "image", "Content Theme": "Lifestyle", "Engagement Rate": 1 }),
    makeRecord({ "Post Type": "image", "Content Theme": "Education", "Engagement Rate": 3 }),
  ];

  const result = avgERByDimensionStacked(
    posts,
    (p) => str(p.fields["Post Type"]),
    (p) => str(p.fields["Content Theme"]),
  );

  it("returns primaries sorted by total metric desc", () => {
    expect(result.primaries.map((p) => p.label)).toEqual(["reel", "image"]);
  });

  it("returns segments sorted by global frequency desc", () => {
    expect(result.segments[0]).toBe("Lifestyle");
  });

  it("computes avg per (primary, segment) cell", () => {
    expect(result.matrix.reel.Lifestyle.avg).toBe(5);
    expect(result.matrix.reel.Lifestyle.count).toBe(2);
    expect(result.matrix.reel.Product.avg).toBe(2);
    expect(result.matrix.image.Education.avg).toBe(3);
  });

  it("fills missing cells with zeros", () => {
    expect(result.matrix.image.Product).toEqual({ avg: 0, count: 0 });
  });

  it("handles empty posts", () => {
    const empty = avgERByDimensionStacked(
      [],
      (p) => str(p.fields["Post Type"]),
      (p) => str(p.fields["Content Theme"]),
    );
    expect(empty.primaries).toEqual([]);
    expect(empty.segments).toEqual([]);
  });

  it("uses 'untagged' for missing keys", () => {
    const p = [
      makeRecord({ "Engagement Rate": 5 }),
    ];
    const r = avgERByDimensionStacked(
      p,
      (x) => str(x.fields["Post Type"]),
      (x) => str(x.fields["Content Theme"]),
    );
    expect(r.primaries[0].label).toBe("untagged");
    expect(r.segments[0]).toBe("untagged");
  });
});

// --- sumByDimensionStacked ---
describe("sumByDimensionStacked", () => {
  const posts = [
    makeRecord({ "Post Type": "reel", "Content Theme": "Lifestyle", Engagement: 100 }),
    makeRecord({ "Post Type": "reel", "Content Theme": "Lifestyle", Engagement: 50 }),
    makeRecord({ "Post Type": "reel", "Content Theme": "Product", Engagement: 20 }),
    makeRecord({ "Post Type": "image", "Content Theme": "Lifestyle", Engagement: 10 }),
  ];

  const result = sumByDimensionStacked(
    posts,
    (p) => str(p.fields["Post Type"]),
    (p) => str(p.fields["Content Theme"]),
    (p) => num(p.fields["Engagement"]),
  );

  it("sums metric per (primary, segment) cell", () => {
    expect(result.matrix.reel.Lifestyle.sum).toBe(150);
    expect(result.matrix.reel.Lifestyle.count).toBe(2);
    expect(result.matrix.reel.Product.sum).toBe(20);
    expect(result.matrix.image.Lifestyle.sum).toBe(10);
  });

  it("orders primaries by total metric desc", () => {
    expect(result.primaries[0].label).toBe("reel");
    expect(result.primaries[0].total).toBe(170);
  });

  it("orders segments by global metric total desc", () => {
    expect(result.segments[0]).toBe("Lifestyle");
    expect(result.segments[1]).toBe("Product");
  });

  it("fills missing cells with zeros", () => {
    expect(result.matrix.image.Product).toEqual({ sum: 0, count: 0 });
  });
});

// --- postingHeatmap ---
describe("postingHeatmap", () => {
  it("creates day-hour grid from posts", () => {
    // 2026-01-05 is a Monday (day 1), 14:00 UTC
    const posts = [
      makeRecord({
        "Published At": "2026-01-05T14:00:00Z",
        "Engagement Rate": 5,
      }),
      makeRecord({
        "Published At": "2026-01-05T14:30:00Z",
        "Engagement Rate": 3,
      }),
    ];
    const result = postingHeatmap(posts);
    expect(result).toHaveLength(1);
    expect(result[0].day).toBe(1); // Monday
    expect(result[0].hour).toBe(14);
    expect(result[0].avgER).toBe(4);
    expect(result[0].count).toBe(2);
  });

  it("skips posts without valid dates", () => {
    const posts = [
      makeRecord({ "Published At": "", "Engagement Rate": 5 }),
      makeRecord({ "Published At": "invalid", "Engagement Rate": 5 }),
    ];
    expect(postingHeatmap(posts)).toEqual([]);
  });
});

// --- splitByPlatform ---
describe("splitByPlatform", () => {
  it("splits metrics into instagram and facebook", () => {
    const metrics = [
      makeRecord({ Platform: "Instagram", Followers: 100 }),
      makeRecord({ Platform: "Facebook", Followers: 50 }),
      makeRecord({ Platform: "Instagram", Followers: 110 }),
    ];
    const { instagram, facebook } = splitByPlatform(metrics);
    expect(instagram).toHaveLength(2);
    expect(facebook).toHaveLength(1);
  });

  it("handles case insensitivity", () => {
    const metrics = [
      makeRecord({ Platform: "INSTAGRAM" }),
      makeRecord({ Platform: "facebook" }),
    ];
    const { instagram, facebook } = splitByPlatform(metrics);
    expect(instagram).toHaveLength(1);
    expect(facebook).toHaveLength(1);
  });

  it("ignores unknown platforms", () => {
    const metrics = [makeRecord({ Platform: "TikTok" })];
    const { instagram, facebook } = splitByPlatform(metrics);
    expect(instagram).toHaveLength(0);
    expect(facebook).toHaveLength(0);
  });
});

// --- groupByPlatform ---
describe("groupByPlatform", () => {
  it("groups records by lowercase platform", () => {
    const records = [
      makeRecord({ Platform: "Instagram", Followers: 100 }),
      makeRecord({ Platform: "Facebook", Followers: 50 }),
      makeRecord({ Platform: "Instagram", Followers: 110 }),
      makeRecord({ Platform: "Pinterest", Saves: 20 }),
    ];
    const map = groupByPlatform(records);
    expect(map.get("instagram")).toHaveLength(2);
    expect(map.get("facebook")).toHaveLength(1);
    expect(map.get("pinterest")).toHaveLength(1);
  });

  it("handles case insensitivity", () => {
    const records = [
      makeRecord({ Platform: "INSTAGRAM" }),
      makeRecord({ Platform: "instagram" }),
    ];
    const map = groupByPlatform(records);
    expect(map.get("instagram")).toHaveLength(2);
  });

  it("skips records with empty platform", () => {
    const records = [
      makeRecord({ Platform: "" }),
      makeRecord({ Platform: "Instagram" }),
    ];
    const map = groupByPlatform(records);
    expect(map.size).toBe(1);
  });

  it("returns empty map for empty array", () => {
    const map = groupByPlatform([]);
    expect(map.size).toBe(0);
  });
});

// --- getPlatformKeys ---
describe("getPlatformKeys", () => {
  it("returns sorted unique platform keys", () => {
    const records = [
      makeRecord({ Platform: "Facebook" }),
      makeRecord({ Platform: "Instagram" }),
      makeRecord({ Platform: "Instagram" }),
      makeRecord({ Platform: "Pinterest" }),
    ];
    const keys = getPlatformKeys(records);
    expect(keys).toEqual(["instagram", "facebook", "pinterest"]);
  });

  it("returns empty array for empty input", () => {
    expect(getPlatformKeys([])).toEqual([]);
  });

  it("puts unknown platforms at the end", () => {
    const records = [
      makeRecord({ Platform: "mastodon" }),
      makeRecord({ Platform: "Instagram" }),
    ];
    const keys = getPlatformKeys(records);
    expect(keys[0]).toBe("instagram");
    expect(keys[1]).toBe("mastodon");
  });
});

// --- topPosts ---
describe("topPosts", () => {
  it("returns top N posts by field", () => {
    const posts = [
      makeRecord({ "Engagement Rate": 1 }),
      makeRecord({ "Engagement Rate": 5 }),
      makeRecord({ "Engagement Rate": 3 }),
    ];
    const result = topPosts(posts, "Engagement Rate", 2);
    expect(result).toHaveLength(2);
    expect(num(result[0].fields["Engagement Rate"])).toBe(5);
    expect(num(result[1].fields["Engagement Rate"])).toBe(3);
  });

  it("does not mutate original array", () => {
    const posts = [
      makeRecord({ "Engagement Rate": 1 }),
      makeRecord({ "Engagement Rate": 5 }),
    ];
    const original = [...posts];
    topPosts(posts, "Engagement Rate", 1);
    expect(posts[0].id).toBe(original[0].id);
  });

  it("returns all when n > array length", () => {
    const posts = [makeRecord({ "Engagement Rate": 1 })];
    expect(topPosts(posts, "Engagement Rate", 5)).toHaveLength(1);
  });
});

// --- sumField ---
describe("sumField", () => {
  it("sums a numeric field", () => {
    const records = [
      makeRecord({ Reach: 100 }),
      makeRecord({ Reach: 200 }),
      makeRecord({ Reach: 300 }),
    ];
    expect(sumField(records, "Reach")).toBe(600);
  });

  it("returns 0 for empty array", () => {
    expect(sumField([], "Reach")).toBe(0);
  });

  it("handles missing field values", () => {
    const records = [makeRecord({ Reach: 100 }), makeRecord({})];
    expect(sumField(records, "Reach")).toBe(100);
  });
});

// --- recordReach (Pinterest has no reach; uses impressions) ---
describe("recordReach", () => {
  it("returns the Reach field for non-Pinterest platforms", () => {
    expect(
      recordReach(makeRecord({ Platform: "instagram", Reach: 500, Impressions: 999 })),
    ).toBe(500);
  });

  it("substitutes Impressions for Pinterest (Reach is structurally 0)", () => {
    expect(
      recordReach(makeRecord({ Platform: "pinterest", Reach: 0, Impressions: 371 })),
    ).toBe(371);
  });

  it("is case/space-insensitive on platform", () => {
    expect(
      recordReach(makeRecord({ Platform: " Pinterest ", Reach: 0, Impressions: 8 })),
    ).toBe(8);
  });

  it("falls back to Reach for Pinterest when impressions are 0", () => {
    expect(
      recordReach(makeRecord({ Platform: "pinterest", Reach: 0, Impressions: 0 })),
    ).toBe(0);
  });
});

// --- sumReach ---
describe("sumReach", () => {
  it("sums reach across mixed platforms, using impressions for Pinterest", () => {
    const records = [
      makeRecord({ Platform: "instagram", Reach: 100, Impressions: 9 }),
      makeRecord({ Platform: "facebook", Reach: 200, Impressions: 9 }),
      makeRecord({ Platform: "pinterest", Reach: 0, Impressions: 50 }),
    ];
    expect(sumReach(records)).toBe(350);
  });

  it("returns 0 for empty array", () => {
    expect(sumReach([])).toBe(0);
  });
});

// --- avgField ---
describe("avgField", () => {
  it("averages a numeric field", () => {
    const records = [
      makeRecord({ "Engagement Rate": 2 }),
      makeRecord({ "Engagement Rate": 4 }),
    ];
    expect(avgField(records, "Engagement Rate")).toBe(3);
  });

  it("returns 0 for empty array", () => {
    expect(avgField([], "Engagement Rate")).toBe(0);
  });
});

// --- buildUnifiedDates ---
describe("buildUnifiedDates", () => {
  it("merges dates from multiple arrays and sorts ascending", () => {
    const a = [makeRecord({ Date: "2026-01-03T00:00:00Z" })];
    const b = [
      makeRecord({ Date: "2026-01-01T00:00:00Z" }),
      makeRecord({ Date: "2026-01-03T00:00:00Z" }),
    ];
    const result = buildUnifiedDates(a, b);
    expect(result).toEqual(["2026-01-01", "2026-01-03"]);
  });

  it("returns empty array for no inputs", () => {
    expect(buildUnifiedDates()).toEqual([]);
  });
});

// --- getComparisonPeriod ---
describe("getComparisonPeriod", () => {
  it("returns prior period for date range", () => {
    // 7-day range: Jan 8-14 → comparison: Jan 1-7
    const result = getComparisonPeriod("2026-01-08", "2026-01-14");
    expect(result).not.toBeNull();
    expect(result!.compEnd).toBe("2026-01-07");
    // Duration is 6 days (14-8), so compStart = Jan 7 - 6 days = Jan 1
    expect(result!.compStart).toBe("2026-01-01");
  });

  it("returns a period for null dates (All Time)", () => {
    const result = getComparisonPeriod(null, null);
    expect(result).not.toBeNull();
    expect(result!.compStart).toBeDefined();
    expect(result!.compEnd).toBeDefined();
  });
});

// --- hashtagFrequency ---
describe("hashtagFrequency", () => {
  it("counts hashtag frequency and avg ER", () => {
    const posts = [
      makeRecord({ Hashtags: "#bootle, #water", "Engagement Rate": 4 }),
      makeRecord({ Hashtags: "#bootle, #eco", "Engagement Rate": 6 }),
    ];
    const result = hashtagFrequency(posts);
    const bootle = result.find((r) => r.tag === "#bootle");
    expect(bootle?.count).toBe(2);
    expect(bootle?.avgER).toBe(5);
  });

  it("handles posts without hashtags", () => {
    const posts = [makeRecord({ "Engagement Rate": 5 })];
    expect(hashtagFrequency(posts)).toEqual([]);
  });

  it("normalizes to lowercase", () => {
    const posts = [
      makeRecord({ Hashtags: "#Bootle", "Engagement Rate": 4 }),
      makeRecord({ Hashtags: "#BOOTLE", "Engagement Rate": 6 }),
    ];
    const result = hashtagFrequency(posts);
    expect(result).toHaveLength(1);
    expect(result[0].tag).toBe("#bootle");
  });

  it("sorts by count descending", () => {
    const posts = [
      makeRecord({ Hashtags: "#rare", "Engagement Rate": 1 }),
      makeRecord({ Hashtags: "#common", "Engagement Rate": 2 }),
      makeRecord({ Hashtags: "#common", "Engagement Rate": 3 }),
      makeRecord({ Hashtags: "#common", "Engagement Rate": 4 }),
    ];
    const result = hashtagFrequency(posts);
    expect(result[0].tag).toBe("#common");
    expect(result[0].count).toBe(3);
    expect(result[1].tag).toBe("#rare");
    expect(result[1].count).toBe(1);
  });
});

// --- alignToDateArray ---
describe("alignToDateArray", () => {
  it("maps metric values to date array", () => {
    const metrics = [
      makeRecord({ Date: "2026-01-01T00:00:00Z", Reach: 100 }),
      makeRecord({ Date: "2026-01-03T00:00:00Z", Reach: 300 }),
    ];
    const dates = ["2026-01-01", "2026-01-02", "2026-01-03"];
    const result = alignToDateArray(metrics, dates, "Reach");
    expect(result).toEqual([100, 0, 300]);
  });

  it("uses custom default value", () => {
    const metrics: AirtableRecord[] = [];
    const dates = ["2026-01-01"];
    const result = alignToDateArray(metrics, dates, "Reach", -1);
    expect(result).toEqual([-1]);
  });
});

// --- alignToDateArrayNullable (gaps render as chart gaps, not zero dips) ---
describe("alignToDateArrayNullable", () => {
  it("returns null (not 0) for dates with no record", () => {
    const metrics = [
      makeRecord({ Date: "2026-01-01T00:00:00Z", Reach: 100 }),
      makeRecord({ Date: "2026-01-03T00:00:00Z", Reach: 300 }),
    ];
    const dates = ["2026-01-01", "2026-01-02", "2026-01-03"];
    expect(alignToDateArrayNullable(metrics, dates, "Reach")).toEqual([
      100,
      null,
      300,
    ]);
  });

  it("returns null when the field is present but empty/absent (honestly no value)", () => {
    // IG account Impressions: the row exists for the day, but the field is
    // empty — there is no honest per-day value. Must be a gap, not a 0 dip.
    const metrics = [
      makeRecord({ Date: "2026-01-01T00:00:00Z", Impressions: "" }),
      makeRecord({ Date: "2026-01-02T00:00:00Z" }),
    ];
    const dates = ["2026-01-01", "2026-01-02"];
    expect(alignToDateArrayNullable(metrics, dates, "Impressions")).toEqual([
      null,
      null,
    ]);
  });

  it("preserves a real 0 as 0, distinct from a gap", () => {
    // FB Engagement genuinely measured 0 — that is a real point, not a gap.
    const metrics = [
      makeRecord({ Date: "2026-01-01T00:00:00Z", Engagement: 0 }),
    ];
    const dates = ["2026-01-01", "2026-01-02"];
    expect(alignToDateArrayNullable(metrics, dates, "Engagement")).toEqual([
      0,
      null,
    ]);
  });

  it("passes through negative values (e.g. Follower Delta)", () => {
    const metrics = [
      makeRecord({ Date: "2026-01-01T00:00:00Z", "Follower Delta": -3 }),
    ];
    expect(
      alignToDateArrayNullable(metrics, ["2026-01-01"], "Follower Delta"),
    ).toEqual([-3]);
  });
});

// --- groupByDimension ---
describe("groupByDimension", () => {
  it("groups by key and averages metric", () => {
    const records = [
      makeRecord({ "Post Type": "Reel", "Engagement Rate": 0.1 }),
      makeRecord({ "Post Type": "Reel", "Engagement Rate": 0.2 }),
      makeRecord({ "Post Type": "Image", "Engagement Rate": 0.05 }),
    ];
    const result = groupByDimension(
      records,
      (r) => String(r.fields["Post Type"]),
      (r) => num(r.fields["Engagement Rate"]),
    );
    const reel = result.find((g) => g.label === "Reel");
    const image = result.find((g) => g.label === "Image");
    expect(reel).toBeDefined();
    expect(reel!.avg).toBeCloseTo(0.15);
    expect(reel!.count).toBe(2);
    expect(image!.avg).toBeCloseTo(0.05);
  });

  it("skips records where metric returns undefined", () => {
    const records = [
      makeRecord({ Platform: "instagram" }),
      makeRecord({ Platform: "tiktok" }),
    ];
    const result = groupByDimension(
      records,
      (r) => String(r.fields["Platform"]),
      () => undefined,
    );
    expect(result).toHaveLength(0);
  });

  it("uses untagged for empty keys", () => {
    const records = [makeRecord({ "Content Theme": "" })];
    const result = groupByDimension(
      records,
      (r) => String(r.fields["Content Theme"] ?? ""),
      () => 0.1,
    );
    expect(result[0].label).toBe("untagged");
  });

  it("returns sorted descending by avg", () => {
    const records = [
      makeRecord({ dim: "A", val: 0.1 }),
      makeRecord({ dim: "B", val: 0.5 }),
      makeRecord({ dim: "C", val: 0.3 }),
    ];
    const result = groupByDimension(
      records,
      (r) => String(r.fields["dim"]),
      (r) => num(r.fields["val"]),
    );
    expect(result[0].label).toBe("B");
    expect(result[1].label).toBe("C");
    expect(result[2].label).toBe("A");
  });
});

// --- timeBucket ---
describe("timeBucket", () => {
  it("returns Morning for 08:00 UTC", () => {
    expect(timeBucket("2026-01-15T08:00:00.000Z")).toBe("Morning");
  });
  it("returns Midday for 13:00 UTC", () => {
    expect(timeBucket("2026-01-15T13:00:00.000Z")).toBe("Midday");
  });
  it("returns Evening for 19:00 UTC", () => {
    expect(timeBucket("2026-01-15T19:00:00.000Z")).toBe("Evening");
  });
  it("returns Night for 02:00 UTC", () => {
    expect(timeBucket("2026-01-15T02:00:00.000Z")).toBe("Night");
  });
  it("returns Night for invalid date", () => {
    expect(timeBucket("not-a-date")).toBe("Night");
  });
});

// --- dayOfWeek ---
describe("dayOfWeek", () => {
  it("returns correct day label", () => {
    expect(dayOfWeek("2026-01-19T12:00:00.000Z")).toBe("Mon");
    expect(dayOfWeek("2026-01-20T12:00:00.000Z")).toBe("Tue");
    expect(dayOfWeek("2026-01-18T12:00:00.000Z")).toBe("Sun");
  });
  it("returns Unknown for invalid date", () => {
    expect(dayOfWeek("bad")).toBe("Unknown");
  });
});
