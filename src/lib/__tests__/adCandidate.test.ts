import { describe, it, expect } from "vitest";
import {
  volumeFactor,
  recencyFactor,
  retentionFactor,
  demoFitWeight,
  scoreCandidate,
  rankCandidates,
  CANDIDATE_WEIGHTS,
  type TargetAudienceProfile,
} from "../adCandidate";
import type { Post, AudienceDemographic } from "../types";

function makePost(overrides: Partial<Post> = {}): Post {
  return {
    id: "rec_test",
    platform: "instagram",
    postType: "Reel",
    publishedAt: "2026-01-15T10:00:00.000Z",
    caption: "Test caption",
    mediaUrl: "https://instagram.com/reel/test",
    hashtags: "",
    reach: 1000,
    impressions: 0,
    engagementRate: 0.02,
    likes: 40,
    comments: 10,
    saves: 20,
    shares: 5,
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

const NEUTRAL = { weight: 1, flagged: true };

describe("volumeFactor", () => {
  it("is 0 for zero/negative reach", () => {
    expect(volumeFactor(0)).toBe(0);
    expect(volumeFactor(-5)).toBe(0);
  });
  it("caps at 1.0 at and above the full-credit anchor", () => {
    expect(volumeFactor(CANDIDATE_WEIGHTS.volumeFullCreditReach)).toBeCloseTo(1, 6);
    expect(volumeFactor(100000)).toBe(1);
  });
  it("is monotonic increasing below the cap", () => {
    expect(volumeFactor(50)).toBeLessThan(volumeFactor(300));
  });
  it("does NOT keep rewarding accumulated reach above the anchor (anti-age-bias)", () => {
    // A post with months of reach (50k) must not beat one at the anchor — both
    // are 'enough reach to trust the rate', so volume stops differentiating.
    expect(volumeFactor(50000)).toBe(volumeFactor(100000));
    expect(volumeFactor(CANDIDATE_WEIGHTS.volumeFullCreditReach * 5)).toBe(1);
  });
});

describe("recencyFactor", () => {
  const NOW = Date.parse("2026-06-17T00:00:00Z");
  const daysAgo = (n: number) =>
    new Date(NOW - n * 86_400_000).toISOString();

  it("is 1.0 for a post published now / today / future", () => {
    expect(recencyFactor(new Date(NOW).toISOString(), NOW)).toBe(1);
    expect(recencyFactor(daysAgo(-3), NOW)).toBe(1); // future-dated
  });
  it("halves at the half-life", () => {
    expect(recencyFactor(daysAgo(CANDIDATE_WEIGHTS.recencyHalfLifeDays), NOW)).toBeCloseTo(0.5, 6);
  });
  it("decays monotonically with age", () => {
    expect(recencyFactor(daysAgo(30), NOW)).toBeGreaterThan(recencyFactor(daysAgo(120), NOW));
  });
  it("clamps to the floor for very old posts (dampened, not erased)", () => {
    expect(recencyFactor(daysAgo(2000), NOW)).toBe(CANDIDATE_WEIGHTS.recencyFloor);
  });
  it("gives full credit to an undated/unparseable post (no penalty for missing data)", () => {
    expect(recencyFactor("", NOW)).toBe(1);
    expect(recencyFactor("not-a-date", NOW)).toBe(1);
  });
});

describe("demoFitWeight", () => {
  const audience: AudienceDemographic[] = [
    { id: "a", snapshotDate: "2026-01-01", audienceType: "follower", breakdown: "age", bucket: "25-34", value: 60 },
    { id: "b", snapshotDate: "2026-01-01", audienceType: "follower", breakdown: "age", bucket: "35-44", value: 40 },
  ];

  it("is neutral (1.0, flagged) when no target is supplied", () => {
    expect(demoFitWeight(audience, undefined)).toEqual({ weight: 1, flagged: true });
  });

  it("is neutral when the audience lacks the target breakdown", () => {
    const target: TargetAudienceProfile = { breakdown: "country", shares: { DE: 1 } };
    expect(demoFitWeight(audience, target).flagged).toBe(true);
  });

  it("returns 1.0 for a perfectly aligned target", () => {
    const target: TargetAudienceProfile = {
      breakdown: "age",
      shares: { "25-34": 60, "35-44": 40 },
    };
    const r = demoFitWeight(audience, target);
    expect(r.flagged).toBe(false);
    expect(r.weight).toBeCloseTo(1, 6);
  });

  it("drops toward the floor for a misaligned target", () => {
    const target: TargetAudienceProfile = {
      breakdown: "age",
      shares: { "55-64": 100 }, // no overlap with the audience buckets
    };
    const r = demoFitWeight(audience, target);
    expect(r.weight).toBeCloseTo(CANDIDATE_WEIGHTS.demoFitFloor, 6);
  });

  it("stays within [floor, 1]", () => {
    const target: TargetAudienceProfile = {
      breakdown: "age",
      shares: { "25-34": 30, "35-44": 70 },
    };
    const r = demoFitWeight(audience, target);
    expect(r.weight).toBeGreaterThanOrEqual(CANDIDATE_WEIGHTS.demoFitFloor);
    expect(r.weight).toBeLessThanOrEqual(1);
  });
});

describe("retentionFactor", () => {
  it("is neutral 1.0 when no signal is supplied", () => {
    expect(retentionFactor(undefined)).toBe(1);
    expect(retentionFactor({})).toBe(1);
  });
  it("reaches 1.0 when both rates clear full-credit anchors", () => {
    expect(
      retentionFactor({ hookRate: 0.3, holdRate: 0.3 }),
    ).toBeCloseTo(1, 6);
  });
  it("drops toward the floor for a weak hook+hold", () => {
    expect(retentionFactor({ hookRate: 0, holdRate: 0 })).toBeCloseTo(
      CANDIDATE_WEIGHTS.retentionFloor,
      6,
    );
  });
  it("a missing half defaults to full credit (statics not dragged down)", () => {
    // hold only, at full credit → hook half defaults to 1 → combined 1 → 1.0.
    expect(retentionFactor({ holdRate: 0.3 })).toBeCloseTo(1, 6);
  });
  it("stays within [floor, 1]", () => {
    const r = retentionFactor({ hookRate: 0.1, holdRate: 0.2 });
    expect(r).toBeGreaterThanOrEqual(CANDIDATE_WEIGHTS.retentionFloor);
    expect(r).toBeLessThanOrEqual(1);
  });
});

describe("scoreCandidate — View B virality (/reach primary, /likes secondary)", () => {
  it("primary viralityIndex uses /reach", () => {
    const post = makePost({ reach: 1000, likes: 40, saves: 20, shares: 5 });
    const s = scoreCandidate(post, NEUTRAL);
    // (25/1000) * volumeFactor(1000) * 1.0
    expect(s.viralityIndex).toBeCloseTo((25 / 1000) * volumeFactor(1000), 6);
  });

  it("secondary viralityIndexByLikes uses /likes", () => {
    const post = makePost({ reach: 1000, likes: 40, saves: 20, shares: 5 });
    const s = scoreCandidate(post, NEUTRAL);
    expect(s.viralityIndexByLikes).toBeCloseTo((25 / 40) * volumeFactor(1000), 6);
  });

  it("primary is undefined below the reach floor", () => {
    const post = makePost({ reach: 50, likes: 40, saves: 20, shares: 5 });
    expect(scoreCandidate(post, NEUTRAL).viralityIndex).toBeUndefined();
  });

  it("primary survives a low like count (reach is the denominator now)", () => {
    const post = makePost({ reach: 1000, likes: 3, saves: 20, shares: 5 });
    const s = scoreCandidate(post, NEUTRAL);
    expect(s.viralityIndex).toBeDefined(); // /reach not gated by likes
    expect(s.viralityIndexByLikes).toBeUndefined(); // /likes still floored
  });

  it("retention scales the score multiplicatively", () => {
    const post = makePost({ reach: 1000, likes: 40, saves: 20, shares: 5 });
    const plain = scoreCandidate(post, NEUTRAL);
    const weak = scoreCandidate(post, NEUTRAL, { hookRate: 0, holdRate: 0 });
    expect(weak.viralityIndex as number).toBeCloseTo(
      (plain.viralityIndex as number) * CANDIDATE_WEIGHTS.retentionFloor,
      6,
    );
  });
});

describe("scoreCandidate — View A intent composite", () => {
  it("produces a 0–100-scaled intentScore for a scoreable IG post", () => {
    const post = makePost({ reach: 1000, comments: 10, saves: 20 });
    const s = scoreCandidate(post, NEUTRAL);
    expect(s.intentScore).toBeDefined();
    expect(s.intentScore as number).toBeGreaterThan(0);
  });

  it("a higher save+comment rate scores higher (volume held equal)", () => {
    const weak = scoreCandidate(makePost({ reach: 1000, comments: 1, saves: 1 }), NEUTRAL);
    const strong = scoreCandidate(makePost({ reach: 1000, comments: 15, saves: 15 }), NEUTRAL);
    expect(strong.intentScore as number).toBeGreaterThan(weak.intentScore as number);
  });

  it("is undefined when the post has no reach (unscoreable)", () => {
    const post = makePost({ platform: "instagram", reach: 0, impressions: 0 });
    expect(scoreCandidate(post, NEUTRAL).intentScore).toBeUndefined();
  });

  it("demo weight scales the intent score multiplicatively", () => {
    const post = makePost({ reach: 1000, comments: 10, saves: 20 });
    const full = scoreCandidate(post, { weight: 1, flagged: false });
    const half = scoreCandidate(post, { weight: 0.5, flagged: false });
    expect(half.intentScore as number).toBeCloseTo(
      (full.intentScore as number) * 0.5,
      6,
    );
  });
});

describe("rankCandidates", () => {
  const posts: Post[] = [
    makePost({ id: "hi", reach: 2000, comments: 20, saves: 40, shares: 15, likes: 60 }),
    makePost({ id: "lo", reach: 800, comments: 1, saves: 1, shares: 0, likes: 50 }),
    makePost({ id: "fluke", reach: 60, comments: 5, saves: 30, shares: 10, likes: 2 }),
  ];

  it("ranks by intentScore by default, strongest first", () => {
    const ranked = rankCandidates(posts, { sortBy: "intentScore" });
    expect(ranked[0].postId).toBe("hi");
  });

  it("with recency (nowMs), a fresh post outranks an OLDER one of equal rate", () => {
    // The reported bug: old posts win on time-in-market. Two identical-rate
    // posts, one recent, one 6 months old; recency must put the fresh one first.
    const NOW = Date.parse("2026-06-17T00:00:00Z");
    const old = makePost({
      id: "old", caption: "old creative", mediaUrl: "https://m/old",
      publishedAt: new Date(NOW - 180 * 86_400_000).toISOString(),
      reach: 2000, saves: 40, shares: 15, comments: 20, likes: 60,
    });
    const fresh = makePost({
      id: "fresh", caption: "fresh creative", mediaUrl: "https://m/fresh",
      publishedAt: new Date(NOW - 5 * 86_400_000).toISOString(),
      reach: 2000, saves: 40, shares: 15, comments: 20, likes: 60,
    });
    // Without recency they tie (old may win on stable sort); WITH it, fresh wins.
    const ranked = rankCandidates([old, fresh], { sortBy: "viralityIndex", nowMs: NOW });
    expect(ranked[0].postId).toBe("fresh");
    expect(ranked[0].viralityIndex as number).toBeGreaterThan(ranked[1].viralityIndex as number);
  });

  it("omitting nowMs disables recency (back-compat — equal-rate posts keep input order)", () => {
    const a = makePost({ id: "a", caption: "a", mediaUrl: "https://m/a", publishedAt: "2025-01-01T00:00:00Z", reach: 2000, saves: 40, shares: 15 });
    const b = makePost({ id: "b", caption: "b", mediaUrl: "https://m/b", publishedAt: "2026-06-01T00:00:00Z", reach: 2000, saves: 40, shares: 15 });
    const ranked = rankCandidates([a, b], { sortBy: "viralityIndex" });
    expect(ranked[0].viralityIndex).toBeCloseTo(ranked[1].viralityIndex as number, 9);
  });

  it("drops posts that are unscoreable on the chosen view", () => {
    // The fluke (reach 60, likes 2) is below View B's floor → excluded there.
    const ranked = rankCandidates(posts, { sortBy: "viralityIndex" });
    expect(ranked.find((r) => r.postId === "fluke")).toBeUndefined();
  });

  it("returns both scores on each ranked entry for side-by-side display", () => {
    const ranked = rankCandidates(posts);
    expect(ranked[0]).toHaveProperty("intentScore");
    expect(ranked[0]).toHaveProperty("viralityIndex");
  });

  it("surfaces post display fields (caption, mediaUrl, type) for the UI", () => {
    const ranked = rankCandidates(posts);
    expect(ranked[0].post.caption).toBe("Test caption");
    expect(ranked[0].post.mediaUrl).toBe("https://instagram.com/reel/test");
    expect(ranked[0].post.postType).toBe("Reel");
  });

  it("does not mutate the input array", () => {
    const input = [...posts];
    rankCandidates(input);
    expect(input.map((p) => p.id)).toEqual(["hi", "lo", "fluke"]);
  });
});

describe("rankCandidates — content de-duplication", () => {
  it("collapses same-content records with different ids to one (keeps best-scored)", () => {
    // Same caption + media, three separate records (the real Pinterest case).
    // Vary saves+shares so the /reach virality score genuinely differs, and sort
    // by that key so the highest-scoring kept instance is deterministic.
    const dup = (id: string, saves: number, shares: number): Post =>
      makePost({
        id,
        platform: "pinterest",
        caption: "If you're tired of buying trends, get a Bootle.",
        mediaUrl: "https://pin/A",
        reach: 1000,
        saves,
        shares,
      });
    const ranked = rankCandidates(
      [dup("p1", 10, 2), dup("p2", 30, 8), dup("p3", 5, 1)],
      { sortBy: "viralityIndex" },
    );
    const matches = ranked.filter((r) => r.post.mediaUrl === "https://pin/A");
    expect(matches).toHaveLength(1);
    expect(matches[0].postId).toBe("p2"); // highest (saves+shares)/reach → kept
  });

  it("keeps genuinely distinct creatives", () => {
    const a = makePost({ id: "a", caption: "Alpha", mediaUrl: "https://m/a", saves: 20 });
    const b = makePost({ id: "b", caption: "Beta", mediaUrl: "https://m/b", saves: 20 });
    expect(rankCandidates([a, b])).toHaveLength(2);
  });

  it("does not merge captionless posts with different media", () => {
    const a = makePost({ id: "a", caption: "", mediaUrl: "https://m/a" });
    const b = makePost({ id: "b", caption: "", mediaUrl: "https://m/b" });
    expect(rankCandidates([a, b])).toHaveLength(2);
  });
});
