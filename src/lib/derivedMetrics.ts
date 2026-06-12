import type { Post } from "./types";
import {
  platformScoreConfig,
  MIN_REACH_DENOMINATOR,
  type Anchor,
  type ComponentSpec,
} from "./scoreConfig";

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

// ===========================================================================
// Benchmark-anchored composite scores (period-independent).
//
// Each platform is scored against its OWN fixed realistic/aspirational anchors
// (see scoreConfig.ts). A component's raw value maps to a 0–1 fraction of its
// weight via scoreFromBenchmark; the weighted sum × 100 is the 0–100 score.
// Nothing here depends on the current filtered view, so a post's score is
// stable across date filters.
// ===========================================================================

/**
 * Piecewise-linear value → 0..1 mapping against two anchors.
 *   <=0 → 0 ; ==realistic → 0.5 ; ==aspirational → 1 ; >aspirational → 1
 * Linear between anchors. Returns the FRACTION of the component earned (0..1).
 */
export function scoreFromBenchmark(value: number, anchor: Anchor): number {
  const { realistic, aspirational } = anchor;
  if (value <= 0) return 0;
  if (value <= realistic) {
    // 0 → realistic maps to 0 → 0.5
    return realistic > 0 ? (value / realistic) * 0.5 : 0;
  }
  if (value >= aspirational) return 1;
  // realistic → aspirational maps to 0.5 → 1
  const span = aspirational - realistic;
  return span > 0 ? 0.5 + ((value - realistic) / span) * 0.5 : 1;
}

/**
 * Raw value for a named scoring component on a post. Rates use a denominator
 * floored at MIN_REACH_DENOMINATOR so a tiny-reach fluke (e.g. 6 engagements
 * on 9 reach) can't read as a huge rate. Returns undefined when the input
 * genuinely can't be computed (no reach/impressions at all).
 */
function componentValue(post: Post, label: string): number | undefined {
  const denom = effectiveReach(post);
  // For rate components we need a usable denominator; floor it so small reach
  // is dampened rather than excluded. If there's no reach at all, the rate is
  // undefined (post can't be scored on rate components).
  const flooredDenom = denom > 0 ? Math.max(denom, MIN_REACH_DENOMINATOR) : 0;

  switch (label) {
    case "Engagement rate":
      // ER is a stored by-reach decimal. A post with zero reach can't have a
      // meaningful engagement rate (the stored value would be contradictory),
      // so it's uncomputable without reach — consistent with the other rates.
      return denom > 0 ? post.engagementRate : undefined;
    case "Save rate":
      return flooredDenom > 0 ? post.saves / flooredDenom : undefined;
    case "Comment rate":
      return flooredDenom > 0 ? post.comments / flooredDenom : undefined;
    case "Outbound click rate":
      // Pinterest outbound clicks live in the "Link Clicks" field.
      return flooredDenom > 0 ? post.linkClicks / flooredDenom : undefined;
    case "Reach":
      return effectiveReach(post);
    case "Impressions":
      return post.impressions;
    default:
      return undefined;
  }
}

export interface ScoreComponent {
  label: string;
  /** Human-readable raw input, e.g. "0.20%" or "183". */
  rawDisplay: string;
  /** Points contributed to the 0–100 composite. */
  points: number;
  /** Max possible points for this component (weight × 100). */
  max: number;
}

function fmtComponent(value: number, spec: ComponentSpec): string {
  if (spec.kind === "rate") return `${(value * 100).toFixed(2)}%`;
  return `${Math.round(value)}`;
}

/**
 * Generic per-component breakdown for one of a platform's score dimensions.
 * Returns undefined if NO component can be computed (e.g. no reach at all on a
 * rate-only score). Components whose value is undefined are scored as 0 points
 * (they still appear in the breakdown so the tooltip is complete).
 */
function scoreBreakdown(
  post: Post,
  specs: ComponentSpec[],
): ScoreComponent[] | undefined {
  const values = specs.map((s) => componentValue(post, s.label));
  // If every component is uncomputable, the post isn't scorable on this score.
  if (values.every((v) => v === undefined)) return undefined;

  return specs.map((spec, i) => {
    const value = values[i] ?? 0;
    const fraction = scoreFromBenchmark(value, spec.anchor);
    return {
      label: spec.label,
      rawDisplay: fmtComponent(value, spec),
      points: fraction * spec.weight * 100,
      max: spec.weight * 100,
    };
  });
}

function sumPoints(components: ScoreComponent[] | undefined): number | undefined {
  if (components === undefined) return undefined;
  return components.reduce((s, c) => s + c.points, 0);
}

/** Composite engagement score 0–100, benchmarked to the post's platform. */
export function engagementScore(post: Post): number | undefined {
  return sumPoints(engagementScoreBreakdown(post));
}

/** Composite reach score 0–100, benchmarked to the post's platform. */
export function reachScore(post: Post): number | undefined {
  return sumPoints(reachScoreBreakdown(post));
}

/** Per-component breakdown of the engagement score (undefined if unscoreable). */
export function engagementScoreBreakdown(
  post: Post,
): ScoreComponent[] | undefined {
  return scoreBreakdown(post, platformScoreConfig(post.platform).engagement);
}

/** Per-component breakdown of the reach score (undefined if unscoreable). */
export function reachScoreBreakdown(post: Post): ScoreComponent[] | undefined {
  return scoreBreakdown(post, platformScoreConfig(post.platform).reach);
}
