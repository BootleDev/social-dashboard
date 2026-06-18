import { describe, it, expect } from "vitest";
import { repostRate } from "../derivedMetrics";
import type { Post } from "../types";

function basePost(overrides: Partial<Post> = {}): Post {
  return {
    id: "rec",
    nativePostId: "instagram_123",
    platform: "instagram",
    postType: "reel",
    publishedAt: "",
    caption: "",
    mediaUrl: "",
    hashtags: "",
    reach: 0,
    impressions: 0,
    engagementRate: 0,
    likes: 0,
    comments: 0,
    saves: 0,
    shares: 0,
    videoViews: 0,
    linkClicks: 0,
    videoLengthSec: 0,
    avgWatchTimeSec: 0,
    skipRate: 0,
    videoViewTotalTimeSec: 0,
    reposts: 0,
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

describe("repostRate", () => {
  it("returns reposts / reach", () => {
    expect(repostRate(basePost({ reposts: 4, reach: 137 }))).toBeCloseTo(4 / 137);
  });

  it("returns undefined when reach is 0", () => {
    expect(repostRate(basePost({ reposts: 1, reach: 0 }))).toBeUndefined();
  });

  it("returns 0 when reposts is 0 and reach is positive", () => {
    expect(repostRate(basePost({ reposts: 0, reach: 100 }))).toBe(0);
  });
});
