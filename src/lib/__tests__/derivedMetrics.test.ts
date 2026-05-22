import { describe, it, expect } from "vitest";
import {
  saveRate,
  commentRate,
  shareRate,
  viewThroughRate,
  watchTimePct,
  engagementScore,
  reachScore,
} from "../derivedMetrics";
import type { Post } from "../types";

function makePost(overrides: Partial<Post> = {}): Post {
  return {
    id: "rec_test",
    platform: "instagram",
    postType: "Reel",
    publishedAt: "2026-01-15T10:00:00.000Z",
    caption: "Test post",
    mediaUrl: "",
    hashtags: "",
    reach: 1000,
    impressions: 0,
    engagementRate: 0.05,
    likes: 40,
    comments: 10,
    saves: 20,
    shares: 5,
    videoViews: 800,
    linkClicks: 0,
    videoLengthSec: 30,
    avgWatchTimeSec: 15,
    contentTheme: "",
    hookPresent: false,
    hookType: "",
    hookText: "",
    voType: "",
    ctaType: "",
    onScreenText: false,
    visualStyle: "",
    setting: "",
    contentPillar: "",
    talentPresent: false,
    draftHookType: "",
    draftVoType: "",
    draftCtaType: "",
    draftVisualStyle: "",
    draftSetting: "",
    draftContentPillar: "",
    taggingStatus: "",
    ...overrides,
  };
}

describe("saveRate", () => {
  it("returns saves / reach", () => {
    expect(saveRate(makePost({ saves: 20, reach: 1000 }))).toBeCloseTo(0.02);
  });
  it("returns undefined when reach is 0", () => {
    expect(saveRate(makePost({ reach: 0 }))).toBeUndefined();
  });
});

describe("commentRate", () => {
  it("returns comments / reach", () => {
    expect(commentRate(makePost({ comments: 10, reach: 1000 }))).toBeCloseTo(0.01);
  });
  it("returns undefined when reach is 0", () => {
    expect(commentRate(makePost({ reach: 0 }))).toBeUndefined();
  });
});

describe("shareRate", () => {
  it("returns shares / reach", () => {
    expect(shareRate(makePost({ shares: 5, reach: 1000 }))).toBeCloseTo(0.005);
  });
});

describe("viewThroughRate", () => {
  it("returns videoViews / reach", () => {
    expect(viewThroughRate(makePost({ videoViews: 800, reach: 1000 }))).toBeCloseTo(0.8);
  });
  it("returns undefined when reach is 0", () => {
    expect(viewThroughRate(makePost({ reach: 0 }))).toBeUndefined();
  });
});

describe("watchTimePct", () => {
  it("returns avgWatchTime / videoLength", () => {
    expect(watchTimePct(makePost({ avgWatchTimeSec: 15, videoLengthSec: 30 }))).toBeCloseTo(0.5);
  });
  it("returns undefined when videoLength is 0", () => {
    expect(watchTimePct(makePost({ videoLengthSec: 0 }))).toBeUndefined();
  });
});

describe("engagementScore", () => {
  it("returns a number 0–100 for a typical post", () => {
    const score = engagementScore(makePost());
    expect(score).toBeDefined();
    expect(score!).toBeGreaterThanOrEqual(0);
    expect(score!).toBeLessThanOrEqual(100);
  });

  it("returns undefined when reach is 0", () => {
    expect(engagementScore(makePost({ reach: 0 }))).toBeUndefined();
  });

  it("scores higher for better engagement", () => {
    const lowEng = makePost({ saves: 5, comments: 2, engagementRate: 0.01 });
    const highEng = makePost({ saves: 100, comments: 50, engagementRate: 0.15 });
    expect(engagementScore(highEng)!).toBeGreaterThan(engagementScore(lowEng)!);
  });
});

describe("reachScore", () => {
  const normalizers = { maxVideoViews: 2000, maxImpressions: 3000, avgFollowers: 5000 };

  it("returns a number 0–100", () => {
    const score = reachScore(makePost(), normalizers);
    expect(score).toBeDefined();
    expect(score!).toBeGreaterThanOrEqual(0);
    expect(score!).toBeLessThanOrEqual(100);
  });

  it("returns undefined when avgFollowers is 0", () => {
    expect(reachScore(makePost(), { ...normalizers, avgFollowers: 0 })).toBeUndefined();
  });

  it("scores higher for better reach", () => {
    const low = makePost({ reach: 100, videoViews: 50 });
    const high = makePost({ reach: 4000, videoViews: 1800 });
    expect(reachScore(high, normalizers)!).toBeGreaterThan(reachScore(low, normalizers)!);
  });
});
