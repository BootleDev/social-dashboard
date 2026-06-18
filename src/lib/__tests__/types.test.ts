import { describe, it, expect } from "vitest";
import {
  toPost,
  toAudienceDemographic,
  toTrendingKeyword,
  toTopPin,
} from "../types";
import type { AirtableRecord } from "../utils";

const rec = (fields: Record<string, unknown>): AirtableRecord => ({
  id: "rec123",
  fields,
  createdTime: "2026-05-26T00:00:00.000Z",
});

describe("toPost — new fields", () => {
  it("maps Skip Rate, Video View Total Time, Reposts", () => {
    const p = toPost(
      rec({
        "Skip Rate": 72.9,
        "Video View Total Time": 1124.9,
        Reposts: 4,
      }),
    );
    expect(p.skipRate).toBe(72.9);
    expect(p.videoViewTotalTimeSec).toBe(1124.9);
    expect(p.reposts).toBe(4);
  });

  it("defaults new fields to 0 when missing", () => {
    const p = toPost(rec({}));
    expect(p.skipRate).toBe(0);
    expect(p.videoViewTotalTimeSec).toBe(0);
    expect(p.reposts).toBe(0);
  });

  it("maps the platform-native Post ID into nativePostId (not the record id)", () => {
    const p = toPost(rec({ "Post ID": "pinterest_1097893215423369870" }));
    expect(p.nativePostId).toBe("pinterest_1097893215423369870");
    expect(p.id).toBe("rec123"); // record id stays separate
  });

  it("defaults nativePostId to empty string when the feed has no Post ID", () => {
    expect(toPost(rec({})).nativePostId).toBe("");
  });
});

describe("toAudienceDemographic", () => {
  it("maps a follower-country row", () => {
    const a = toAudienceDemographic(
      rec({
        "Snapshot Date": "2026-05-26",
        "Audience Type": "follower",
        Breakdown: "country",
        Bucket: "GB",
        Value: 312,
      }),
    );
    expect(a).toEqual({
      id: "rec123",
      snapshotDate: "2026-05-26",
      audienceType: "follower",
      breakdown: "country",
      bucket: "GB",
      value: 312,
    });
  });

  it("handles missing value as 0", () => {
    const a = toAudienceDemographic(
      rec({
        "Snapshot Date": "2026-05-26",
        "Audience Type": "engaged",
        Breakdown: "age",
        Bucket: "25-34",
      }),
    );
    expect(a.value).toBe(0);
    expect(a.audienceType).toBe("engaged");
  });
});

describe("toTrendingKeyword", () => {
  it("maps a full trending-keyword row", () => {
    const t = toTrendingKeyword(
      rec({
        "Snapshot Date": "2026-05-26",
        Region: "GB+IE",
        "Trend Type": "growing",
        Keyword: "holiday nails",
        Rank: 1,
        "Pct Growth WoW": 20,
        "Pct Growth MoM": 60,
        "Pct Growth YoY": 0,
        "Has Prediction": true,
        "Time Series": '{"2026-05-15":91}',
      }),
    );
    expect(t.keyword).toBe("holiday nails");
    expect(t.rank).toBe(1);
    expect(t.pctGrowthMoM).toBe(60);
    expect(t.hasPrediction).toBe(true);
    expect(t.timeSeriesJson).toBe('{"2026-05-15":91}');
  });

  it("treats missing Has Prediction as false", () => {
    const t = toTrendingKeyword(rec({ Keyword: "summer nails" }));
    expect(t.hasPrediction).toBe(false);
  });
});

describe("toTopPin", () => {
  it("maps a top-pin row by IMPRESSION", () => {
    const p = toTopPin(
      rec({
        "Snapshot Date": "2026-05-26",
        "Sort By": "IMPRESSION",
        Rank: 1,
        "Pin ID": "1097893215423369870",
        "Post ID": "pinterest_1097893215423369870",
        "Window Days": 30,
        Impressions: 269,
        Saves: 1,
        "Pin Click": 8,
        "Outbound Click": 0,
        Engagement: 9,
        "Video MRC View": 0,
        "Video Avg Watch Time": 0,
        "Near Complete Views": 0,
      }),
    );
    expect(p.sortBy).toBe("IMPRESSION");
    expect(p.impressions).toBe(269);
    expect(p.pinClick).toBe(8);
    expect(p.postId).toBe("pinterest_1097893215423369870");
  });

  it("defaults missing numeric fields to 0", () => {
    const p = toTopPin(rec({ "Pin ID": "abc" }));
    expect(p.impressions).toBe(0);
    expect(p.saves).toBe(0);
    expect(p.videoMrcView).toBe(0);
  });

  it("reads Thumbnail URL when present and defaults to empty string", () => {
    const withThumb = toTopPin(
      rec({ "Pin ID": "abc", "Thumbnail URL": "https://i.pinimg.com/x.jpg" }),
    );
    expect(withThumb.thumbnailUrl).toBe("https://i.pinimg.com/x.jpg");
    const withoutThumb = toTopPin(rec({ "Pin ID": "abc" }));
    expect(withoutThumb.thumbnailUrl).toBe("");
  });
});
