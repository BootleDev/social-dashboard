import type { Post } from "./types";
import { DEFAULT_WEIGHTS, type ReachWeights, type EngagementWeights } from "./scoreConfig";

function safeRate(numerator: number, denominator: number): number | undefined {
  if (denominator <= 0) return undefined;
  return numerator / denominator;
}

/**
 * Reach for a post, accounting for platform differences.
 *
 * Pinterest's API does not report a reach metric for pins — the "Reach" field
 * is structurally 0 for every Pinterest row, while Impressions ARE populated.
 * Impressions are Pinterest's top-of-funnel volume metric, so we use them as
 * the reach-equivalent. Without this, every Pinterest pin shows 0 reach AND
 * all reach-denominated rates (save/comment/share rate) and the Engagement
 * Score come out undefined for Pinterest.
 *
 * All other platforms report real reach, so they pass through unchanged.
 */
export function effectiveReach(post: Post): number {
  if (post.platform === "pinterest") {
    return post.impressions > 0 ? post.impressions : post.reach;
  }
  return post.reach;
}

export function saveRate(post: Post): number | undefined {
  return safeRate(post.saves, effectiveReach(post));
}

export function commentRate(post: Post): number | undefined {
  return safeRate(post.comments, effectiveReach(post));
}

export function shareRate(post: Post): number | undefined {
  return safeRate(post.shares, effectiveReach(post));
}

/**
 * Reposts / Reach — proxy for full re-share propagation. Distinct from
 * shareRate, which counts share-button taps. Reposts mean the post was
 * re-published into another account's feed, a stronger algorithmic signal.
 */
export function repostRate(post: Post): number | undefined {
  return safeRate(post.reposts, effectiveReach(post));
}

export function reachRate(post: Post, followers: number): number | undefined {
  return safeRate(effectiveReach(post), followers);
}

/** VideoViews / Reach — proxy for view-through when completion data isn't available. */
export function viewThroughRate(post: Post): number | undefined {
  return safeRate(post.videoViews, effectiveReach(post));
}

/** AvgWatchTime / VideoLength — only meaningful when both fields are populated. */
export function watchTimePct(post: Post): number | undefined {
  if (post.videoLengthSec <= 0) return undefined;
  return safeRate(post.avgWatchTimeSec, post.videoLengthSec);
}

export interface ReachNormalizers {
  maxVideoViews: number;
  maxImpressions: number;
  avgFollowers: number;
}

/** Composite reach score 0–100, relative to the current filtered post set. */
export function reachScore(
  post: Post,
  normalizers: ReachNormalizers,
  weights: ReachWeights = DEFAULT_WEIGHTS.reach,
): number | undefined {
  const rr = reachRate(post, normalizers.avgFollowers);
  if (rr === undefined) return undefined;

  const normViews =
    normalizers.maxVideoViews > 0
      ? Math.min(post.videoViews / normalizers.maxVideoViews, 1)
      : 0;
  const normImpressions =
    normalizers.maxImpressions > 0
      ? Math.min(post.impressions / normalizers.maxImpressions, 1)
      : 0;

  // reachRate is unbounded (can exceed 1 for viral posts); cap at 2x for scoring
  const normRR = Math.min(rr / 2, 1);

  return (
    (normRR * weights.reachRate +
      normViews * weights.videoViews +
      normImpressions * weights.impressions) *
    100
  );
}

/** Composite engagement score 0–100. */
export function engagementScore(
  post: Post,
  weights: EngagementWeights = DEFAULT_WEIGHTS.engagement,
): number | undefined {
  const sr = saveRate(post);
  const cr = commentRate(post);
  if (sr === undefined || cr === undefined) return undefined;

  // ER is stored as 0–1 decimal; cap at 0.3 (30%) for normalisation
  const normER = Math.min(post.engagementRate / 0.3, 1);
  // Save rate and comment rate cap at 0.15 (15%) each
  const normSR = Math.min(sr / 0.15, 1);
  const normCR = Math.min(cr / 0.15, 1);

  return (
    (normSR * weights.saveRate +
      normER * weights.engagementRate +
      normCR * weights.commentRate) *
    100
  );
}

/**
 * One component of a composite score: its raw input rate, and the points it
 * contributes to the 0–100 composite (out of `max` possible points). The
 * contributions across a score's components sum to the composite value, so a
 * breakdown reads as "saveRate 0.2% → 3.2 / 40 pts".
 */
export interface ScoreComponent {
  label: string;
  /** Human-readable raw input, e.g. "0.2%" or "120 views". */
  rawDisplay: string;
  /** Points contributed to the 0–100 composite. */
  points: number;
  /** Max possible points for this component (weight * 100). */
  max: number;
}

function pct(v: number, decimals = 2): string {
  return `${(v * 100).toFixed(decimals)}%`;
}

/** Per-component breakdown of engagementScore for one post (undefined if score is). */
export function engagementScoreBreakdown(
  post: Post,
  weights: EngagementWeights = DEFAULT_WEIGHTS.engagement,
): ScoreComponent[] | undefined {
  const sr = saveRate(post);
  const cr = commentRate(post);
  if (sr === undefined || cr === undefined) return undefined;

  const normER = Math.min(post.engagementRate / 0.3, 1);
  const normSR = Math.min(sr / 0.15, 1);
  const normCR = Math.min(cr / 0.15, 1);

  return [
    {
      label: "Save rate",
      rawDisplay: pct(sr),
      points: normSR * weights.saveRate * 100,
      max: weights.saveRate * 100,
    },
    {
      label: "Engagement rate",
      rawDisplay: pct(post.engagementRate),
      points: normER * weights.engagementRate * 100,
      max: weights.engagementRate * 100,
    },
    {
      label: "Comment rate",
      rawDisplay: pct(cr),
      points: normCR * weights.commentRate * 100,
      max: weights.commentRate * 100,
    },
  ];
}

/** Per-component breakdown of reachScore for one post (undefined if score is). */
export function reachScoreBreakdown(
  post: Post,
  normalizers: ReachNormalizers,
  weights: ReachWeights = DEFAULT_WEIGHTS.reach,
): ScoreComponent[] | undefined {
  const rr = reachRate(post, normalizers.avgFollowers);
  if (rr === undefined) return undefined;

  const normViews =
    normalizers.maxVideoViews > 0
      ? Math.min(post.videoViews / normalizers.maxVideoViews, 1)
      : 0;
  const normImpressions =
    normalizers.maxImpressions > 0
      ? Math.min(post.impressions / normalizers.maxImpressions, 1)
      : 0;
  const normRR = Math.min(rr / 2, 1);

  return [
    {
      label: "Reach rate",
      rawDisplay: pct(rr),
      points: normRR * weights.reachRate * 100,
      max: weights.reachRate * 100,
    },
    {
      label: "Video views",
      rawDisplay: `${post.videoViews}`,
      points: normViews * weights.videoViews * 100,
      max: weights.videoViews * 100,
    },
    {
      label: "Impressions",
      rawDisplay: `${post.impressions}`,
      points: normImpressions * weights.impressions * 100,
      max: weights.impressions * 100,
    },
  ];
}
