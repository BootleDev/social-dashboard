/**
 * Paid-ad candidate scorer — rank existing organic posts as paid-promotion
 * candidates by the signals that predict ad success. Pure; consumes the Post
 * shape already in the dashboard and reuses the benchmark-anchored engagement
 * score rather than inventing a parallel one.
 *
 * TWO VIEWS, side by side (so the strongest predictor can be chosen against
 * real ad results, not assumed):
 *
 *   View A — intentScore (the predictive composite):
 *     Leads with the active-intent + distribution signals that survive the jump
 *     from organic feed to paid placement — saves (intent to return/buy),
 *     shares (earned distribution) and comments (Bootle's measured strength) —
 *     each as a reach-denominated rate scored against the existing platform
 *     benchmark anchors. Then VOLUME-SCALED by a log-dampened reach factor (a
 *     strong rate on real reach beats the same rate on a fluke), and
 *     DEMO-FIT-WEIGHTED by alignment of the post's audience with the target
 *     buyer. Built on engagementScoreBreakdown from derivedMetrics.ts.
 *
 *   View B — viralityIndex (the literal ratio):
 *     (saves + shares) / REACH is the PRIMARY denominator (matches the
 *     dashboard's by-reach convention and the "rank by shares+saves / reach"
 *     advice — reach is the honest exposure base, not the cheap like count).
 *     (saves + shares) / likes is kept as a SECONDARY ratio for comparison.
 *     Both are gated by a VOLUME FLOOR (min reach, and min likes for the
 *     likes-ratio) so a fluke can't top the list, then volume + demo weighted.
 *
 * RETENTION (video): an optional Hook Rate (3s views / impressions) and Hold
 * Rate (ThruPlay / 3s views) multiply the score for video candidates — the
 * arbiter of whether a clip survives as an ad. When unavailable (statics, or no
 * retention data) the retention factor is neutral 1.0.
 *
 * Likes are a cheap signal, so View A uses them only via the existing
 * engagement rate, and View B treats /reach as primary with /likes secondary.
 */

import type { Post, AudienceDemographic } from "./types";
import {
  effectiveReach,
  engagementScoreBreakdown,
  type ScoreComponent,
} from "./derivedMetrics";

// ===========================================================================
// Tunable weights / floors (pattern: scoreConfig.ts — exported, test-pinned)
// ===========================================================================

export const CANDIDATE_WEIGHTS = {
  /**
   * Reach at which the log-dampened volume factor reaches 1.0 (full credit).
   * Below it, the factor scales down; above it, it's capped at 1.0 so a viral
   * post isn't rewarded twice. Tuned to Bootle's IG p90 reach (~620).
   */
  volumeFullCreditReach: 620,
  /**
   * View B volume floor: a post needs at least this much reach AND this many
   * likes for its (saves+shares)/likes ratio to be trusted. Below either, the
   * viralityIndex is undefined (excluded from the ranking, not zero-ranked).
   */
  minReachForRatio: 100,
  minLikesForRatio: 10,
  /**
   * Demo-fit weight bounds. A perfectly-aligned audience scores 1.0; a
   * perfectly-misaligned one scores this floor (never 0 — a misaligned post is
   * dampened, not erased). Neutral (no target supplied / no demo data) = 1.0.
   */
  demoFitFloor: 0.5,
  /**
   * Retention weight bounds for video. Hook Rate and Hold Rate (each a
   * fraction) combine into a factor in [retentionFloor, 1] — a weak hook/hold
   * dampens but never zeroes the score; missing retention data is neutral 1.0.
   * Anchors are the fractions at which each rate earns FULL credit.
   */
  retentionFloor: 0.5,
  /** Hook rate (3s/impressions) at which the hook earns full credit. */
  hookFullCredit: 0.3,
  /** Hold rate (ThruPlay/3s) at which the hold earns full credit. */
  holdFullCredit: 0.3,
} as const;

// ===========================================================================
// Volume factor
// ===========================================================================

/**
 * Log-dampened volume factor in (0, 1]. Uses log1p so reach 0 → 0 and the
 * curve flattens as reach approaches the full-credit anchor, capped at 1.0.
 * Rewards posts that earned their rate on real reach without letting a single
 * viral post dominate linearly.
 */
export function volumeFactor(reach: number): number {
  if (!Number.isFinite(reach) || reach <= 0) return 0;
  const full = CANDIDATE_WEIGHTS.volumeFullCreditReach;
  const factor = Math.log1p(reach) / Math.log1p(full);
  return Math.min(1, factor);
}

// ===========================================================================
// Retention factor (video)
// ===========================================================================

/**
 * Optional per-post video retention signal. hookRate = 3s views / impressions,
 * holdRate = ThruPlay / 3s views — both decimal fractions. Sourced from a
 * paired Ad Snapshot when the post has been run as an ad, or omitted for posts
 * with no retention data. Either field may be undefined independently.
 */
export interface RetentionSignal {
  hookRate?: number;
  holdRate?: number;
}

/**
 * Combine hook + hold into a retention factor in [retentionFloor, 1]. Each rate
 * earns up to half the [floor, 1] band, scaled linearly to its full-credit
 * anchor and capped. A post with neither signal returns neutral 1.0 (never
 * penalized for missing data); one signal contributes its half and the other
 * defaults to full credit so a static isn't dragged down.
 */
export function retentionFactor(signal: RetentionSignal | undefined): number {
  if (!signal || (signal.hookRate === undefined && signal.holdRate === undefined)) {
    return 1;
  }
  const frac = (rate: number | undefined, anchor: number): number =>
    rate === undefined
      ? 1 // missing → full credit for that half
      : Math.min(1, Math.max(0, rate / anchor));
  const hook = frac(signal.hookRate, CANDIDATE_WEIGHTS.hookFullCredit);
  const hold = frac(signal.holdRate, CANDIDATE_WEIGHTS.holdFullCredit);
  const combined = (hook + hold) / 2; // 0..1
  const floor = CANDIDATE_WEIGHTS.retentionFloor;
  return floor + (1 - floor) * combined;
}

// ===========================================================================
// Demo-fit weight
// ===========================================================================

/**
 * A target audience profile: for one breakdown (e.g. "age" or "country"), the
 * desired share of each bucket. Shares should sum to ~1 but are normalized
 * defensively. Supplied by the caller (the buyer Bootle wants to reach); when
 * absent the demo weight is neutral.
 */
export interface TargetAudienceProfile {
  breakdown: AudienceDemographic["breakdown"];
  /** bucket → desired share (e.g. { "25-34": 0.5, "35-44": 0.3, ... }). */
  shares: Record<string, number>;
}

/** Normalize a share map to sum to 1; returns null if the total is non-positive. */
function normalizeShares(
  shares: Record<string, number>,
): Record<string, number> | null {
  const entries = Object.entries(shares).filter(
    ([, v]) => Number.isFinite(v) && v > 0,
  );
  const total = entries.reduce((s, [, v]) => s + v, 0);
  if (total <= 0) return null;
  return Object.fromEntries(entries.map(([k, v]) => [k, v / total]));
}

/**
 * Demo-fit weight in [demoFitFloor, 1]. Compares the account audience
 * distribution (the follower buckets for the target breakdown) against the
 * desired target profile via Bhattacharyya overlap (sum of sqrt(p*q)), a
 * bounded similarity in [0, 1], then maps that overlap onto [floor, 1].
 *
 * Returns 1.0 (neutral) and `flagged: true` when no target is supplied or the
 * audience feed lacks the target breakdown — a post is never penalized for
 * missing data, only for measured misalignment.
 *
 * NOTE: this is account-level audience, not per-post audience (the data store
 * has no per-post demographics). So demo-fit is a constant multiplier across
 * posts for a given target — it ranks the whole library's fit, and becomes
 * per-post automatically if/when per-post demographics ever land.
 */
export function demoFitWeight(
  audience: ReadonlyArray<AudienceDemographic>,
  target: TargetAudienceProfile | undefined,
): { weight: number; flagged: boolean } {
  if (!target) return { weight: 1, flagged: true };

  const targetShares = normalizeShares(target.shares);
  if (!targetShares) return { weight: 1, flagged: true };

  // Account audience = follower buckets for the target breakdown.
  const buckets = audience.filter(
    (r) => r.audienceType === "follower" && r.breakdown === target.breakdown,
  );
  const audShares = normalizeShares(
    Object.fromEntries(buckets.map((b) => [b.bucket, b.value])),
  );
  if (!audShares) return { weight: 1, flagged: true };

  // Bhattacharyya overlap over the union of buckets.
  const keys = new Set([...Object.keys(targetShares), ...Object.keys(audShares)]);
  let overlap = 0;
  for (const k of keys) {
    overlap += Math.sqrt((targetShares[k] ?? 0) * (audShares[k] ?? 0));
  }
  overlap = Math.min(1, Math.max(0, overlap));

  const floor = CANDIDATE_WEIGHTS.demoFitFloor;
  return { weight: floor + (1 - floor) * overlap, flagged: false };
}

// ===========================================================================
// Per-post scores
// ===========================================================================

export interface CandidateScore {
  postId: string;
  platform: string;
  /** Display + link fields so the UI can show a recognizable, clickable row. */
  post: {
    /** Post Type / format, e.g. "Reel", "Static". */
    postType: string;
    /** Caption (full; the UI truncates for display). */
    caption: string;
    /** Media URL — the post permalink for IG/FB, the link-out for Pinterest. */
    mediaUrl: string;
    /** ISO publish timestamp. */
    publishedAt: string;
  };
  /** View A: intent-led composite, 0–100 scale before display rounding. */
  intentScore: number | undefined;
  /**
   * View B (primary): (saves+shares)/REACH after the volume floor, volume +
   * demo + retention weighted. Undefined if floored out.
   */
  viralityIndex: number | undefined;
  /**
   * View B (secondary): (saves+shares)/LIKES, the literal ratio, for
   * comparison. Undefined if below the likes floor.
   */
  viralityIndexByLikes: number | undefined;
  /** Inputs that produced the scores, for tooltips/debugging. */
  breakdown: {
    intentComponents: ScoreComponent[] | undefined;
    volumeFactor: number;
    demoWeight: number;
    demoFlagged: boolean;
    retentionFactor: number;
    saves: number;
    shares: number;
    likes: number;
    reach: number;
  };
}

/**
 * The active-intent slice of the engagement breakdown: comment + save (+
 * outbound-click on Pinterest) rates, the components that predict paid
 * performance. Share rate isn't in the benchmark config, so View A folds shares
 * in through the volume/virality side; here we reuse exactly what the existing
 * score already computes and benchmarks, summing the intent components' points.
 */
function intentPoints(post: Post): {
  points: number | undefined;
  components: ScoreComponent[] | undefined;
} {
  const components = engagementScoreBreakdown(post);
  if (components === undefined) return { points: undefined, components };
  const intentLabels = new Set([
    "Comment rate",
    "Save rate",
    "Outbound click rate",
  ]);
  const intent = components.filter((c) => intentLabels.has(c.label));
  if (intent.length === 0) return { points: undefined, components };
  // Renormalize the intent slice to 0–100 so a post judged only on intent
  // components is on the same scale regardless of how many apply on its platform.
  const earned = intent.reduce((s, c) => s + c.points, 0);
  const max = intent.reduce((s, c) => s + c.max, 0);
  const points = max > 0 ? (earned / max) * 100 : undefined;
  return { points, components };
}

/**
 * Primary virality ratio (saves+shares)/REACH, gated by the reach volume floor;
 * undefined if reach is too small to trust.
 */
function viralityRatioByReach(post: Post): number | undefined {
  const reach = effectiveReach(post);
  // minReachForRatio (>0) already excludes zero/negative reach.
  if (reach < CANDIDATE_WEIGHTS.minReachForRatio) return undefined;
  return (post.saves + post.shares) / reach;
}

/**
 * Secondary literal ratio (saves+shares)/likes, gated by reach AND a likes
 * floor so a low-like fluke can't top the comparison; undefined if floored.
 */
function viralityRatioByLikes(post: Post): number | undefined {
  const reach = effectiveReach(post);
  if (
    reach < CANDIDATE_WEIGHTS.minReachForRatio ||
    post.likes < CANDIDATE_WEIGHTS.minLikesForRatio ||
    post.likes <= 0
  ) {
    return undefined;
  }
  return (post.saves + post.shares) / post.likes;
}

/**
 * Score one post on both views. `demo` is the precomputed demo-fit (constant
 * across posts for a given target), passed in so the caller computes it once.
 * `retention` is an optional per-post video retention signal.
 */
export function scoreCandidate(
  post: Post,
  demo: { weight: number; flagged: boolean },
  retention?: RetentionSignal,
): CandidateScore {
  const reach = effectiveReach(post);
  const vf = volumeFactor(reach);
  const rf = retentionFactor(retention);
  const { points: intentBase, components } = intentPoints(post);

  // Combined multiplicative weighting applied to every view.
  const weight = vf * demo.weight * rf;

  // View A: benchmark intent points × weights, kept on a 0–100 scale.
  const intentScore = intentBase === undefined ? undefined : intentBase * weight;

  // View B primary (/reach) and secondary (/likes), both weighted.
  const byReach = viralityRatioByReach(post);
  const viralityIndex = byReach === undefined ? undefined : byReach * weight;
  const byLikes = viralityRatioByLikes(post);
  const viralityIndexByLikes =
    byLikes === undefined ? undefined : byLikes * weight;

  return {
    postId: post.id,
    platform: post.platform,
    post: {
      postType: post.postType,
      caption: post.caption,
      mediaUrl: post.mediaUrl,
      publishedAt: post.publishedAt,
    },
    intentScore,
    viralityIndex,
    viralityIndexByLikes,
    breakdown: {
      intentComponents: components,
      volumeFactor: vf,
      demoWeight: demo.weight,
      demoFlagged: demo.flagged,
      retentionFactor: rf,
      saves: post.saves,
      shares: post.shares,
      likes: post.likes,
      reach,
    },
  };
}

export type CandidateSortKey =
  | "intentScore"
  | "viralityIndex"
  | "viralityIndexByLikes";

/**
 * Rank posts as paid-ad candidates by the chosen view. Posts whose score for
 * that view is undefined (unscoreable / floored out) are dropped from the
 * ranking, not sorted to the bottom — they're not candidates on that measure.
 * Demo-fit is computed once and shared. Immutable: returns a new sorted array.
 */
export function rankCandidates(
  posts: ReadonlyArray<Post>,
  options: {
    sortBy?: CandidateSortKey;
    audience?: ReadonlyArray<AudienceDemographic>;
    target?: TargetAudienceProfile;
    /** Per-post-id video retention signals (hook/hold), when available. */
    retention?: Readonly<Record<string, RetentionSignal>>;
  } = {},
): CandidateScore[] {
  const sortBy = options.sortBy ?? "intentScore";
  const demo = demoFitWeight(options.audience ?? [], options.target);
  const retention = options.retention ?? {};

  const scored = posts.map((p) => scoreCandidate(p, demo, retention[p.id]));
  const ranked = scored
    .filter((s) => s[sortBy] !== undefined)
    .sort((a, b) => (b[sortBy] as number) - (a[sortBy] as number));

  // De-dupe by CONTENT identity, not postId: the same creative is frequently
  // present as several rows (e.g. one Pinterest pin pinned to multiple boards,
  // or sync-created duplicates) with distinct ids but identical caption + media.
  // As ad creative they're the same asset, so showing it 3× is noise. Keep the
  // highest-scoring instance (the list is already sorted best-first).
  const seen = new Set<string>();
  const deduped: CandidateScore[] = [];
  for (const s of ranked) {
    const key = candidateContentKey(s);
    if (seen.has(key)) continue;
    seen.add(key);
    deduped.push(s);
  }
  return deduped;
}

/**
 * Content-identity key for de-duplication: platform + normalized caption + media
 * URL. Two scored candidates with the same key are the same creative asset even
 * if they are separate records with different post ids.
 */
function candidateContentKey(s: CandidateScore): string {
  const caption = (s.post.caption ?? "").trim().toLowerCase();
  const media = (s.post.mediaUrl ?? "").trim();
  // Caption alone is the strongest signal; media URL disambiguates captionless
  // posts. Fall back to postId so a fully-empty post is never merged with another.
  if (caption || media) return `${s.platform}|${caption}|${media}`;
  return `id:${s.postId}`;
}
