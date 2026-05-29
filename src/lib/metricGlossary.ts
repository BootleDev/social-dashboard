/**
 * Central glossary of metric definitions surfaced via <InfoTooltip />.
 *
 * One source of truth so a term (VTR, Save Rate, Engagement Score, ...) reads
 * the same wherever it appears: KPI cards, chart headers, table columns, axis
 * labels. Every definition here is derived from the actual computation in
 * `derivedMetrics.ts` / `scoreConfig.ts` — when a formula changes there, update
 * the matching entry here so the tooltip never drifts from the math.
 *
 * Keys are stable identifiers (not display labels). Look up by key, or use
 * `glossaryFor(label)` to resolve a human label / table header to an entry.
 */

export interface MetricDefinition {
  /** Stable identifier used as the glossary key. */
  key: string;
  /** Full term, spelled out. e.g. "View-Through Rate". */
  term: string;
  /** One- or two-sentence plain-language definition. */
  definition: string;
  /** Optional formula, shown after the definition. e.g. "Video views / reach". */
  formula?: string;
}

/**
 * NOTE: "reach" below means *effective* reach — for Pinterest, impressions are
 * used as the reach-equivalent because Pinterest's API reports no pin-level
 * reach (see effectiveReach() in derivedMetrics.ts). The tooltips keep the word
 * "reach" for readability; the Pinterest nuance lives on the Reach entry.
 */
export const METRIC_GLOSSARY: Record<string, MetricDefinition> = {
  vtr: {
    key: "vtr",
    term: "View-Through Rate",
    definition:
      "Share of people reached who watched the video. A proxy for view-through used when completion data isn't available.",
    formula: "Video views / reach",
  },
  saveRate: {
    key: "saveRate",
    term: "Save Rate",
    definition:
      "Share of people reached who saved the post. A strong signal for algorithmic distribution.",
    formula: "Saves / reach",
  },
  commentRate: {
    key: "commentRate",
    term: "Comment Rate",
    definition: "Share of people reached who commented on the post.",
    formula: "Comments / reach",
  },
  shareRate: {
    key: "shareRate",
    term: "Share Rate",
    definition:
      "Share of people reached who tapped the share button. Counts share taps, distinct from full reposts.",
    formula: "Shares / reach",
  },
  repostRate: {
    key: "repostRate",
    term: "Repost Rate",
    definition:
      "Share of people reached who re-published the post into another feed. A stronger propagation signal than a share-button tap.",
    formula: "Reposts / reach",
  },
  reachRate: {
    key: "reachRate",
    term: "Reach Rate",
    definition: "Share of the account's followers the post reached.",
    formula: "Reach / followers",
  },
  watchTimePct: {
    key: "watchTimePct",
    term: "Watch-Time %",
    definition:
      "Average share of the video that viewers watched. Only meaningful when both average watch time and video length are reported.",
    formula: "Avg watch time / video length",
  },
  engagementRate: {
    key: "engagementRate",
    term: "Engagement Rate",
    definition:
      "Share of people reached who engaged with the post. Reported per-platform and stored against reach.",
  },
  engagementScore: {
    key: "engagementScore",
    term: "Engagement Score",
    definition:
      "A 0-100 composite scoring the post's engagement against its own platform's realistic and aspirational benchmarks, so scores are comparable across platforms and stable across date filters. Hover the value for the per-component breakdown.",
  },
  reachScore: {
    key: "reachScore",
    term: "Reach Score",
    definition:
      "A 0-100 composite scoring the post's reach/impressions against its own platform's realistic and aspirational benchmarks, so scores are comparable across platforms and stable across date filters. Hover the value for the per-component breakdown.",
  },
  reach: {
    key: "reach",
    term: "Reach",
    definition:
      "Unique accounts that saw the post. Pinterest reports no pin-level reach, so impressions are used as the reach-equivalent there.",
  },
  impressions: {
    key: "impressions",
    term: "Impressions",
    definition:
      "Total times the post was displayed, including repeat views by the same account.",
  },
  followers: {
    key: "followers",
    term: "Followers",
    definition: "Accounts following the profile at the end of the range.",
  },
  videoViews: {
    key: "videoViews",
    term: "Video Views",
    definition: "Total times the video started playing.",
  },
  linkClicks: {
    key: "linkClicks",
    term: "Link Clicks",
    definition:
      "Outbound clicks on the post's link. On Pinterest, this is the pin's outbound clicks.",
  },
  saves: {
    key: "saves",
    term: "Saves",
    definition: "Times the post was saved or bookmarked.",
  },
  shares: {
    key: "shares",
    term: "Shares",
    definition: "Times the post was shared via the share button.",
  },
  reposts: {
    key: "reposts",
    term: "Reposts",
    definition: "Times the post was re-published into another account's feed.",
  },
  likes: {
    key: "likes",
    term: "Likes",
    definition: "Total likes on the post.",
  },
  comments: {
    key: "comments",
    term: "Comments",
    definition: "Total comments on the post.",
  },
  skipRate: {
    key: "skipRate",
    term: "Skip Rate",
    definition:
      "Share of viewers who skipped past the post/video. Lower is better. Reported per-platform.",
  },
  postsPublished: {
    key: "postsPublished",
    term: "Posts Published",
    definition: "Count of posts published in the selected range.",
  },
};

/**
 * Render a definition into the single-string format <InfoTooltip /> expects.
 * Appends the formula on its own bullet line when present (InfoTooltip splits
 * on "•"), so the formula reads as a distinct line under the definition.
 */
export function tooltipText(key: string): string | undefined {
  const def = METRIC_GLOSSARY[key];
  if (!def) return undefined;
  return def.formula
    ? `${def.definition} • ${def.formula}`
    : def.definition;
}

/**
 * Map common display labels and table headers to glossary keys. Lets call
 * sites pass the label they already render ("VTR", "Save Rate", "ER") and get
 * the right definition without threading keys everywhere.
 */
const LABEL_TO_KEY: Record<string, string> = {
  // Table SortField values
  VTR: "vtr",
  "Save Rate": "saveRate",
  "Engagement Rate": "engagementRate",
  "Engagement Score": "engagementScore",
  "Reach Score": "reachScore",
  "Skip Rate": "skipRate",
  Reach: "reach",
  Impressions: "impressions",
  Reposts: "reposts",
  Saves: "saves",
  Shares: "shares",
  Likes: "likes",
  "Video Views": "videoViews",
  "Link Clicks": "linkClicks",
  Comments: "comments",
  // Common abbreviations / KPI titles
  ER: "engagementRate",
  "Avg Engagement Rate": "engagementRate",
  "Avg Save Rate": "saveRate",
  "Total Reach": "reach",
  "Total Followers": "followers",
  "Posts Published": "postsPublished",
  // Full metric-selector labels (DimensionSlicer / BestTimeToPost)
  "View-Through Rate": "vtr",
  "Comment Rate": "commentRate",
  "Share Rate": "shareRate",
  "Repost Rate": "repostRate",
  "Watch Time %": "watchTimePct",
  Followers: "followers",
};

/** Resolve a display label or header to its tooltip text, if known. */
export function glossaryFor(label: string): string | undefined {
  const key = LABEL_TO_KEY[label] ?? label;
  return tooltipText(key);
}
