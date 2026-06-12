/**
 * Per-platform, benchmark-anchored scoring configuration.
 *
 * Scores are 0–100 and PERIOD-INDEPENDENT: each component maps a post's raw
 * value to points against two FIXED anchors (realistic, aspirational) rather
 * than against the current filtered view. So a post scores the same regardless
 * of the dashboard date filter.
 *
 * Mapping (piecewise-linear, see scoreFromBenchmark in derivedMetrics.ts):
 *   value <= 0                 -> 0 pts
 *   value == realistic         -> 50% of the component's max points
 *   value == aspirational      -> 100% of the component's max points
 *   value >  aspirational      -> capped at 100%
 * So a composite score of 50 = "on par with platform norms for our size",
 * 100 = aspirational, 80+ = genuinely strong.
 *
 * Anchors are grounded in (a) 2025–26 external organic benchmarks segmented by
 * account size and, critically, by the BY-REACH engagement denominator this
 * dashboard uses (Dash Social by-reach, Socialinsider per-post absolutes), and
 * (b) Bootle's own measured distribution (median = realistic, ~p90 = strong)
 * where external per-post absolutes were unavailable. See the redesign notes.
 *
 * Denominator note: Instagram ER/save/comment rates are computed BY REACH.
 * Do not swap in by-followers benchmarks (≈0.4–0.5%) — they would set targets
 * 3–5× too low. Pinterest has no reach; it uses Impressions as the denominator.
 *
 * Rate anchors are DECIMAL fractions (0.015 = 1.5%), matching the rate
 * functions which return decimals. Count anchors are absolute (reach, impressions).
 */

export interface Anchor {
  /** Value (decimal for rates, absolute for counts) that scores 50 points-share. */
  realistic: number;
  /** Value that scores 100 points-share. */
  aspirational: number;
}

export interface ComponentSpec {
  /** Human label for tooltips. */
  label: string;
  /** Share of the composite this component owns (weights within a score sum to 1). */
  weight: number;
  /** Benchmark anchors for this component on this platform. */
  anchor: Anchor;
  /** "rate" => formatted as %; "count" => formatted as integer. Display only. */
  kind: "rate" | "count";
}

export interface PlatformScoreConfig {
  engagement: ComponentSpec[];
  reach: ComponentSpec[];
}

/**
 * Reach below this is too small for a rate to be trustworthy (e.g. 6
 * engagements on 9 reach = 66.7%). We FLOOR the rate denominator at this value
 * rather than excluding the post, so tiny-reach flukes are dampened but the
 * post is still scored. Applied to reach-denominated rates only.
 */
export const MIN_REACH_DENOMINATOR = 50;

/**
 * Per-platform scoring config. Each platform is scored ONLY on metrics that are
 * meaningful for it (Pinterest has no comments/reach; Facebook has no saves and
 * is judged on a low-volume scale). A score of 80 on Pinterest and 80 on
 * Instagram both mean "strong for that platform".
 */
export const PLATFORM_SCORES: Record<string, PlatformScoreConfig> = {
  instagram: {
    // Comments are Bootle's genuine strength (mean 0.85%, p90 1.7%), so they
    // carry the most weight; saves are weak for us but a real quality signal.
    engagement: [
      {
        label: "Comment rate",
        weight: 0.4,
        kind: "rate",
        anchor: { realistic: 0.002, aspirational: 0.005 }, // 0.2% → 0.5% by reach
      },
      {
        label: "Save rate",
        weight: 0.3,
        kind: "rate",
        anchor: { realistic: 0.0015, aspirational: 0.004 }, // 0.15% → 0.4% by reach
      },
      {
        label: "Engagement rate",
        weight: 0.3,
        kind: "rate",
        anchor: { realistic: 0.015, aspirational: 0.03 }, // 1.5% → 3.0% by reach
      },
    ],
    // Drops the old period-relative video-views term and the broken
    // follower-based reach-rate term; absolute reach + impressions only.
    reach: [
      {
        label: "Reach",
        weight: 0.6,
        kind: "count",
        anchor: { realistic: 180, aspirational: 620 }, // our median → p90
      },
      {
        label: "Impressions",
        weight: 0.4,
        kind: "count",
        anchor: { realistic: 500, aspirational: 1500 }, // Socialinsider 1–5K tier
      },
    ],
  },

  pinterest: {
    // Impressions-only platform; saves + outbound clicks are the engagement
    // signals (no comments, no reach).
    engagement: [
      {
        label: "Save rate",
        weight: 0.5,
        kind: "rate",
        anchor: { realistic: 0.003, aspirational: 0.01 }, // 0.3% → 1.0% of impressions
      },
      {
        label: "Outbound click rate",
        weight: 0.5,
        kind: "rate",
        anchor: { realistic: 0.003, aspirational: 0.01 }, // 0.3% → 1.0% of impressions
      },
    ],
    reach: [
      {
        label: "Impressions",
        weight: 1,
        kind: "count",
        anchor: { realistic: 18, aspirational: 134 }, // our per-pin median → p90
      },
    ],
  },

  facebook: {
    // Dormant, ~80 followers, no saves/comments recorded — a single light
    // score on its own low-volume scale.
    engagement: [
      {
        label: "Engagement rate",
        weight: 1,
        kind: "rate",
        anchor: { realistic: 0.0015, aspirational: 0.006 }, // 0.15% → 0.6% by reach
      },
    ],
    reach: [
      {
        label: "Reach",
        weight: 1,
        kind: "count",
        anchor: { realistic: 12, aspirational: 56 }, // our median → p90
      },
    ],
  },
};

/** Platforms with no dedicated config fall back to Instagram's. */
export const FALLBACK_PLATFORM = "instagram";

export function platformScoreConfig(platform: string): PlatformScoreConfig {
  return PLATFORM_SCORES[platform] ?? PLATFORM_SCORES[FALLBACK_PLATFORM];
}
