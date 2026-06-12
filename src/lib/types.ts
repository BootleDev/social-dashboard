import { num, str, count, type AirtableRecord } from "./utils";

export interface Post {
  id: string;
  platform: string;
  postType: string;
  publishedAt: string;
  caption: string;
  mediaUrl: string;
  hashtags: string;

  // Raw metrics
  reach: number;
  impressions: number;
  engagementRate: number;
  likes: number;
  comments: number;
  saves: number;
  shares: number;
  videoViews: number;
  linkClicks: number;
  videoLengthSec: number;
  avgWatchTimeSec: number;
  // Added 2026-05-26: extra Reels signals (IG) + repost propagation count.
  // skipRate is 0-100 (percentage), not 0-1. Reels only; 0 on non-video.
  // videoViewTotalTimeSec is cumulative playtime in seconds across all viewers.
  skipRate: number;
  videoViewTotalTimeSec: number;
  reposts: number;

  // Content dimensions (committed — used for slicing)
  contentTheme: string;
  hookPresent: boolean;
  hookType: string;
  hookText: string;
  voType: string;
  ctaType: string;
  onScreenText: boolean;
  visualStyle: string;
  setting: string;
  contentPillar: string;
  talentPresent: boolean;

  // Draft dimensions (proposed by LLM, awaiting approval)
  draftHookType: string;
  draftVoType: string;
  draftCtaType: string;
  draftVisualStyle: string;
  draftSetting: string;
  draftContentPillar: string;

  taggingStatus: "Untagged" | "Draft" | "Approved" | "";
}

export function toPost(r: AirtableRecord): Post {
  return {
    id: r.id,
    platform: str(r.fields["Platform"]).toLowerCase().trim(),
    postType: str(r.fields["Post Type"]),
    publishedAt: str(r.fields["Published At"]),
    caption: str(r.fields["Caption"]),
    mediaUrl: str(r.fields["Media URL"]),
    hashtags: str(r.fields["Hashtags"]),

    // Count fields → count(): non-negative integers; a negative or fractional
    // tally is a data error and must not drag a reach/engagement total.
    reach: count(r.fields["Reach"]),
    impressions: count(r.fields["Impressions"]),
    // Rates/durations stay num(): legitimately fractional, ER can't be negative
    // but we keep it signed-tolerant and let consumers floor the denominator.
    engagementRate: num(r.fields["Engagement Rate"]),
    likes: count(r.fields["Likes"]),
    comments: count(r.fields["Comments"]),
    saves: count(r.fields["Saves"]),
    shares: count(r.fields["Shares"]),
    videoViews: count(r.fields["Video Views"]),
    linkClicks: count(r.fields["Link Clicks"]),
    videoLengthSec: num(r.fields["Video Length (s)"]),
    avgWatchTimeSec: num(r.fields["Avg Watch Time (s)"]),
    skipRate: num(r.fields["Skip Rate"]),
    videoViewTotalTimeSec: num(r.fields["Video View Total Time"]),
    reposts: count(r.fields["Reposts"]),

    contentTheme: str(r.fields["Content Theme"]),
    hookPresent: Boolean(r.fields["Hook Present"]),
    hookType: str(r.fields["Hook Type"]),
    hookText: str(r.fields["Hook Text"]),
    voType: str(r.fields["VO Type"]),
    ctaType: str(r.fields["CTA Type"]),
    onScreenText: Boolean(r.fields["On-Screen Text"]),
    visualStyle: str(r.fields["Visual Style"]),
    setting: str(r.fields["Setting"]),
    contentPillar: str(r.fields["Content Pillar"]),
    talentPresent: Boolean(r.fields["Talent Present"]),

    draftHookType: str(r.fields["_Draft Hook Type"]),
    draftVoType: str(r.fields["_Draft VO Type"]),
    draftCtaType: str(r.fields["_Draft CTA Type"]),
    draftVisualStyle: str(r.fields["_Draft Visual Style"]),
    draftSetting: str(r.fields["_Draft Setting"]),
    draftContentPillar: str(r.fields["_Draft Content Pillar"]),

    taggingStatus: (str(r.fields["Tagging Status"]) as Post["taggingStatus"]) || "",
  };
}

// =====================================================================
// Per-channel data feeds (added 2026-05-26).
//
// Naming convention: one interface + one to{X} mapper per (channel, data-type)
// pair. When adding a new channel/feed, follow this same pattern so the
// dashboard components don't need refactoring to discover the data.
// =====================================================================

/** Instagram follower / engaged-audience demographics snapshot row. */
export interface AudienceDemographic {
  id: string;
  snapshotDate: string;
  audienceType: "follower" | "engaged";
  breakdown: "age" | "gender" | "country" | "city";
  bucket: string;
  value: number;
}

export function toAudienceDemographic(r: AirtableRecord): AudienceDemographic {
  return {
    id: r.id,
    snapshotDate: str(r.fields["Snapshot Date"]),
    audienceType: str(r.fields["Audience Type"]) as AudienceDemographic["audienceType"],
    breakdown: str(r.fields["Breakdown"]) as AudienceDemographic["breakdown"],
    bucket: str(r.fields["Bucket"]),
    value: num(r.fields["Value"]),
  };
}

/** Pinterest trending keyword from the Trends API. */
export interface TrendingKeyword {
  id: string;
  snapshotDate: string;
  region: string;
  trendType: "growing" | "monthly" | "yearly" | "seasonal";
  keyword: string;
  rank: number;
  pctGrowthWoW: number;
  pctGrowthMoM: number;
  pctGrowthYoY: number;
  hasPrediction: boolean;
  /** 52-week relative search volume series, normalized 0-100. Empty string if not set. */
  timeSeriesJson: string;
}

export function toTrendingKeyword(r: AirtableRecord): TrendingKeyword {
  return {
    id: r.id,
    snapshotDate: str(r.fields["Snapshot Date"]),
    region: str(r.fields["Region"]),
    trendType: str(r.fields["Trend Type"]) as TrendingKeyword["trendType"],
    keyword: str(r.fields["Keyword"]),
    rank: num(r.fields["Rank"]),
    pctGrowthWoW: num(r.fields["Pct Growth WoW"]),
    pctGrowthMoM: num(r.fields["Pct Growth MoM"]),
    pctGrowthYoY: num(r.fields["Pct Growth YoY"]),
    hasPrediction: Boolean(r.fields["Has Prediction"]),
    timeSeriesJson: str(r.fields["Time Series"]),
  };
}

/** Pinterest top-performing pin snapshot, sorted by a chosen metric. */
export interface TopPin {
  id: string;
  snapshotDate: string;
  sortBy: "IMPRESSION" | "SAVE" | "OUTBOUND_CLICK" | "PIN_CLICK" | "ENGAGEMENT";
  rank: number;
  pinId: string;
  postId: string;
  windowDays: number;
  impressions: number;
  saves: number;
  pinClick: number;
  outboundClick: number;
  engagement: number;
  videoMrcView: number;
  videoAvgWatchTimeSec: number;
  nearCompleteViews: number;
  /**
   * Direct CDN URL to the pin's image, written by the Pinterest Trends
   * Refresher when available. Falls back to "" if the field isn't populated
   * (e.g. for snapshots taken before the workflow added the column). UI
   * code should treat empty as "look up via Posts table".
   */
  thumbnailUrl: string;
}

export function toTopPin(r: AirtableRecord): TopPin {
  return {
    id: r.id,
    snapshotDate: str(r.fields["Snapshot Date"]),
    sortBy: str(r.fields["Sort By"]) as TopPin["sortBy"],
    rank: num(r.fields["Rank"]),
    pinId: str(r.fields["Pin ID"]),
    postId: str(r.fields["Post ID"]),
    windowDays: num(r.fields["Window Days"]),
    impressions: num(r.fields["Impressions"]),
    saves: num(r.fields["Saves"]),
    pinClick: num(r.fields["Pin Click"]),
    outboundClick: num(r.fields["Outbound Click"]),
    engagement: num(r.fields["Engagement"]),
    videoMrcView: num(r.fields["Video MRC View"]),
    videoAvgWatchTimeSec: num(r.fields["Video Avg Watch Time"]),
    nearCompleteViews: num(r.fields["Near Complete Views"]),
    thumbnailUrl: str(r.fields["Thumbnail URL"]),
  };
}
