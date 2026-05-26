import type { Post } from "./types";
import { DEFAULT_WEIGHTS, type ReachWeights, type EngagementWeights } from "./scoreConfig";

function safeRate(numerator: number, denominator: number): number | undefined {
  if (denominator <= 0) return undefined;
  return numerator / denominator;
}

export function saveRate(post: Post): number | undefined {
  return safeRate(post.saves, post.reach);
}

export function commentRate(post: Post): number | undefined {
  return safeRate(post.comments, post.reach);
}

export function shareRate(post: Post): number | undefined {
  return safeRate(post.shares, post.reach);
}

/**
 * Reposts / Reach — proxy for full re-share propagation. Distinct from
 * shareRate, which counts share-button taps. Reposts mean the post was
 * re-published into another account's feed, a stronger algorithmic signal.
 */
export function repostRate(post: Post): number | undefined {
  return safeRate(post.reposts, post.reach);
}

export function reachRate(post: Post, followers: number): number | undefined {
  return safeRate(post.reach, followers);
}

/** VideoViews / Reach — proxy for view-through when completion data isn't available. */
export function viewThroughRate(post: Post): number | undefined {
  return safeRate(post.videoViews, post.reach);
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
