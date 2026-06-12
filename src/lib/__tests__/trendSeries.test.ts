import { describe, it, expect } from "vitest";
import {
  followerTrendSeries,
  reachTrendSeries,
  engagementTrendSeries,
  trendCoverage,
  type TrendSeries,
} from "../trendSeries";
import type { AirtableRecord } from "../utils";

/** Minimal Account Daily Facts row (account-grain reach/followers). */
function fact(
  date: string,
  platform: string,
  fields: Record<string, unknown> = {},
): AirtableRecord {
  return {
    id: `fact_${platform}_${date}`,
    createdTime: "",
    fields: { Date: date, Platform: platform, ...fields },
  };
}

/** Minimal post row (post-level engagement). */
function post(
  publishedAt: string,
  platform: string,
  fields: Record<string, unknown> = {},
): AirtableRecord {
  return {
    id: `post_${platform}_${publishedAt}`,
    createdTime: "",
    fields: { "Published At": publishedAt, Platform: platform, ...fields },
  };
}

describe("followerTrendSeries", () => {
  it("returns one dataset per platform, aligned to the unified date axis", () => {
    const facts = [
      fact("2026-05-01", "instagram", { Followers: 700 }),
      fact("2026-05-02", "instagram", { Followers: 705 }),
      fact("2026-05-02", "facebook", { Followers: 79 }),
    ];
    const series = followerTrendSeries(facts);
    expect(series.labels).toEqual(["05-01", "05-02"]);
    const ig = series.datasets.find((d) => d.platform === "instagram")!;
    expect(ig.data).toEqual([700, 705]);
    const fb = series.datasets.find((d) => d.platform === "facebook")!;
    // Facebook has no 05-01 row → honest gap (null), not a dip to zero.
    expect(fb.data).toEqual([null, 79]);
  });

  it("sorts datasets in canonical platform order", () => {
    const facts = [
      fact("2026-05-01", "pinterest", { Followers: 5 }),
      fact("2026-05-01", "instagram", { Followers: 700 }),
    ];
    const series = followerTrendSeries(facts);
    expect(series.datasets.map((d) => d.platform)).toEqual([
      "instagram",
      "pinterest",
    ]);
  });

  it("renders an empty (no-row) series with empty labels and datasets", () => {
    const series = followerTrendSeries([]);
    expect(series.labels).toEqual([]);
    expect(series.datasets).toEqual([]);
  });
});

describe("reachTrendSeries", () => {
  it("plots account-grain reach per platform with honest gaps", () => {
    const facts = [
      fact("2026-05-01", "instagram", { Reach: 1200 }),
      fact("2026-05-02", "instagram", { Reach: 1500 }),
    ];
    const series = reachTrendSeries(facts);
    const ig = series.datasets.find((d) => d.platform === "instagram")!;
    expect(ig.data).toEqual([1200, 1500]);
  });

  it("treats an absent Reach cell as a gap, not a zero", () => {
    const facts = [
      fact("2026-05-01", "instagram", { Reach: 1200 }),
      fact("2026-05-02", "instagram", {}), // no Reach reported this day
    ];
    const series = reachTrendSeries(facts);
    const ig = series.datasets.find((d) => d.platform === "instagram")!;
    expect(ig.data).toEqual([1200, null]);
  });

  it("preserves a genuine measured zero as a real point", () => {
    const facts = [
      fact("2026-05-01", "instagram", { Reach: 0 }),
      fact("2026-05-02", "instagram", { Reach: 1500 }),
    ];
    const series = reachTrendSeries(facts);
    const ig = series.datasets.find((d) => d.platform === "instagram")!;
    expect(ig.data).toEqual([0, 1500]);
  });
});

describe("engagementTrendSeries", () => {
  it("sums post-level engagement per day across platforms", () => {
    const posts = [
      post("2026-05-01T10:00:00Z", "instagram", { Engagement: 30 }),
      post("2026-05-01T14:00:00Z", "instagram", { Engagement: 20 }),
      post("2026-05-02T09:00:00Z", "facebook", { Engagement: 5 }),
    ];
    const series = engagementTrendSeries(posts);
    expect(series.labels).toEqual(["05-01", "05-02"]);
    const ig = series.datasets.find((d) => d.platform === "instagram")!;
    // 05-01 has two IG posts (30 + 20); 05-02 has no IG post → 0 (a genuine
    // zero: nothing was published/engaging that day for this platform).
    expect(ig.data).toEqual([50, 0]);
    const fb = series.datasets.find((d) => d.platform === "facebook")!;
    expect(fb.data).toEqual([0, 5]);
  });

  it("returns an empty series when there are no posts", () => {
    const series = engagementTrendSeries([]);
    expect(series.labels).toEqual([]);
    expect(series.datasets).toEqual([]);
  });
});

describe("trendCoverage", () => {
  it("counts distinct measured days across the account facts", () => {
    const facts = [
      fact("2026-05-01", "instagram", { Followers: 700 }),
      fact("2026-05-01", "facebook", { Followers: 79 }),
      fact("2026-05-02", "instagram", { Followers: 705 }),
    ];
    // Two distinct calendar days measured (05-01, 05-02).
    expect(trendCoverage(facts).measuredDays).toBe(2);
  });

  it("reports the first and last measured date", () => {
    const facts = [
      fact("2026-05-03", "instagram", { Followers: 1 }),
      fact("2026-05-01", "instagram", { Followers: 1 }),
    ];
    const cov = trendCoverage(facts);
    expect(cov.firstDate).toBe("2026-05-01");
    expect(cov.lastDate).toBe("2026-05-03");
  });

  it("flags a thin window below the readable-trend floor", () => {
    const facts = [fact("2026-05-01", "instagram", { Followers: 1 })];
    expect(trendCoverage(facts).isThin).toBe(true);
  });

  it("does not flag a dense window as thin", () => {
    const facts = Array.from({ length: 10 }, (_, i) =>
      fact(`2026-05-${String(i + 1).padStart(2, "0")}`, "instagram", {
        Followers: 700 + i,
      }),
    );
    expect(trendCoverage(facts).isThin).toBe(false);
  });

  it("reports zero measured days and isThin for an empty set", () => {
    const cov = trendCoverage([]);
    expect(cov.measuredDays).toBe(0);
    expect(cov.isThin).toBe(true);
    expect(cov.firstDate).toBeNull();
    expect(cov.lastDate).toBeNull();
  });
});

describe("TrendSeries shape", () => {
  it("carries a platform label and colour on each dataset for rendering", () => {
    const facts = [fact("2026-05-01", "instagram", { Followers: 700 })];
    const series: TrendSeries = followerTrendSeries(facts);
    const ig = series.datasets[0];
    expect(ig.label).toBe("Instagram");
    expect(ig.color).toMatch(/^#/);
  });
});
