export const DEFAULT_WEIGHTS = {
  reach: {
    reachRate: 0.5,
    videoViews: 0.3,
    impressions: 0.2,
  },
  engagement: {
    saveRate: 0.4,
    engagementRate: 0.35,
    commentRate: 0.25,
  },
} as const;

export type ReachWeights = typeof DEFAULT_WEIGHTS.reach;
export type EngagementWeights = typeof DEFAULT_WEIGHTS.engagement;
