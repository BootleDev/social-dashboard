import { describe, it, expect } from "vitest";
import {
  num,
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
