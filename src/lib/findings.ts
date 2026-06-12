/**
 * Auto-generated "Top Findings" derived from Posts data.
 *
 * Each finding is a short headline + a one-line detail. Findings are
 * deterministic: same posts in -> same findings out, ordered by severity.
 * Designed to surface 3-5 actionable signals at the top of the Insights tab
 * without the user having to interpret every chart.
 *
 * Quality bar:
 *   - Numbers must trace back to a real cell in the data (no synthesis).
 *   - Each finding suggests a direction, not a recommendation.
 *   - Tiny samples are flagged, not hidden.
 */

import { num, str, type AirtableRecord } from "./utils";

export type Severity = "positive" | "neutral" | "warning";

export interface Finding {
  id: string;
  severity: Severity;
  headline: string;
  detail: string;
}

interface Group {
  key: string;
  posts: AirtableRecord[];
  totalEngagement: number;
  avgER: number;
  totalImpressions: number;
}

function groupBy(
  posts: AirtableRecord[],
  keyFn: (p: AirtableRecord) => string,
  opts: { skipEmpty?: boolean } = {},
): Group[] {
  const map = new Map<string, AirtableRecord[]>();
  for (const p of posts) {
    const k = keyFn(p);
    if (opts.skipEmpty && (!k || k === "untagged" || k === "unknown")) continue;
    if (!map.has(k)) map.set(k, []);
    map.get(k)!.push(p);
  }
  const groups: Group[] = [];
  for (const [key, ps] of map) {
    let eng = 0;
    let er = 0;
    let imp = 0;
    let erCount = 0;
    for (const p of ps) {
      eng += num(p.fields["Engagement"]);
      imp += num(p.fields["Impressions"]);
      const r = num(p.fields["Engagement Rate"]);
      if (r > 0) {
        er += r;
        erCount += 1;
      }
    }
    groups.push({
      key,
      posts: ps,
      totalEngagement: eng,
      avgER: erCount > 0 ? er / erCount : 0,
      totalImpressions: imp,
    });
  }
  return groups;
}

function pct(n: number): string {
  return `${(n * 100).toFixed(1)}%`;
}

function ratio(a: number, b: number): string {
  if (b === 0) return "∞";
  const r = a / b;
  return r >= 10 ? `${r.toFixed(0)}×` : `${r.toFixed(1)}×`;
}

export function generateFindings(posts: AirtableRecord[]): Finding[] {
  const findings: Finding[] = [];

  if (posts.length === 0) {
    return [
      {
        id: "no-data",
        severity: "neutral",
        headline: "No posts in window",
        detail: "Adjust the date range or platform filter to load data.",
      },
    ];
  }

  // ── Finding 1: best Theme × Post Type combo by engagement per post ───────
  // Ranking is per-post (not total) so a high-volume low-quality combo
  // doesn't get falsely crowned. Min n=3 per group to avoid single-post
  // outliers. Baseline excludes groups with zero total engagement so
  // tracking-broken platforms (e.g. Pinterest returning 0 across the
  // board) don't inflate the lift artificially.
  const MIN_GROUP_N = 3;
  // Below this many posts, a winning combo is an early read, not a proven
  // strength — it stays surfaced but as a neutral "Note" with an explicit
  // small-sample caveat, so the green "Strength" badge is reserved for combos
  // we actually have the volume to trust.
  const CONFIDENT_GROUP_N = 5;
  const themeFormat = groupBy(
    posts,
    (p) =>
      `${str(p.fields["Content Theme"]) || "untagged"}|${str(p.fields["Post Type"]) || "unknown"}`,
    { skipEmpty: true },
  );
  const eligible = themeFormat.filter((g) => g.posts.length >= MIN_GROUP_N);
  eligible.sort(
    (a, b) =>
      b.totalEngagement / b.posts.length - a.totalEngagement / a.posts.length,
  );
  const top = eligible[0];
  if (top && top.totalEngagement > 0) {
    const topPerPost = top.totalEngagement / top.posts.length;
    const [theme, fmt] = top.key.split("|");
    const baseline = eligible
      .slice(1)
      .filter((g) => g.totalEngagement > 0)
      .map((g) => g.totalEngagement / g.posts.length);
    const baselineAvg =
      baseline.length > 0
        ? baseline.reduce((a, b) => a + b, 0) / baseline.length
        : 0;
    const lift = baselineAvg > 0 ? topPerPost / baselineAvg : 0;
    // Confident enough to call a "Strength" only with sufficient volume.
    const confident = top.posts.length >= CONFIDENT_GROUP_N;
    const liftClause =
      lift > 1.5
        ? ` — ${lift.toFixed(1)}× the per-post average of other engaged combos (excludes zero-engagement groups).`
        : ".";
    const caveat = confident
      ? ""
      : ` Early read — only ${top.posts.length} posts, so treat as a lead to test, not a proven winner.`;
    findings.push({
      id: "top-combo",
      severity: confident ? "positive" : "neutral",
      headline: confident
        ? `${theme} × ${fmt} is your strongest combo`
        : `${theme} × ${fmt} is an early front-runner`,
      detail: `${top.posts.length} posts averaging ${topPerPost.toFixed(
        1,
      )} engagement each${liftClause}${caveat}`,
    });
  }

  // ── Finding 2: format-mix mismatch (volume vs ER share) ───────────────────
  const byFormat = groupBy(posts, (p) => str(p.fields["Post Type"]) || "unknown");
  byFormat.sort((a, b) => b.avgER - a.avgER);
  const bestFormat = byFormat.find((g) => g.posts.length >= 3);
  const worstFormat = [...byFormat]
    .reverse()
    .find((g) => g.posts.length >= 3);
  if (
    bestFormat &&
    worstFormat &&
    bestFormat.key !== worstFormat.key &&
    bestFormat.avgER > 0 &&
    worstFormat.avgER > 0 &&
    bestFormat.avgER / worstFormat.avgER >= 3
  ) {
    const sharePct = (g: Group) => (g.posts.length / posts.length) * 100;
    const lift = ratio(bestFormat.avgER, worstFormat.avgER);
    findings.push({
      id: "format-mix",
      severity:
        sharePct(worstFormat) > sharePct(bestFormat) ? "warning" : "neutral",
      headline: `${bestFormat.key} earns ${lift} the ER of ${worstFormat.key}`,
      detail: `${bestFormat.key} (${bestFormat.posts.length} posts, ${pct(
        bestFormat.avgER,
      )} avg ER) vs ${worstFormat.key} (${worstFormat.posts.length} posts, ${pct(
        worstFormat.avgER,
      )} avg ER). ${worstFormat.key} is ${sharePct(worstFormat).toFixed(
        0,
      )}% of recent volume.`,
    });
  }

  // ── Finding 3: zero-impression Pinterest noise ────────────────────────────
  const pinterestPosts = posts.filter(
    (p) => str(p.fields["Platform"]) === "pinterest",
  );
  const zeroImp = pinterestPosts.filter(
    (p) => num(p.fields["Impressions"]) === 0,
  );
  if (pinterestPosts.length >= 10 && zeroImp.length / pinterestPosts.length >= 0.4) {
    const allZero = zeroImp.length === pinterestPosts.length;
    findings.push({
      id: "pinterest-zero",
      severity: "warning",
      headline: `${zeroImp.length} of ${pinterestPosts.length} Pinterest pins have zero impressions`,
      detail: allZero
        ? `100% of pins in window show zero impressions. That's almost certainly a data-pipeline issue (Pinterest API call failing, not a real engagement collapse) — check Pinterest Top Pins table to confirm live impressions exist, then investigate the n8n Pinterest Data Refresher.`
        : `${((zeroImp.length / pinterestPosts.length) * 100).toFixed(
            0,
          )}% of pins in window haven't surfaced. Worth investigating board placement, keyword fit, or recency thresholds.`,
    });
  }

  // ── Finding 4: untagged volume ────────────────────────────────────────────
  const untagged = posts.filter(
    (p) =>
      !str(p.fields["Content Theme"]) ||
      !str(p.fields["Content Pillar"]) ||
      str(p.fields["Tagging Status"]) === "Untagged",
  );
  if (untagged.length / posts.length >= 0.2 && untagged.length >= 5) {
    findings.push({
      id: "untagged",
      severity: "warning",
      headline: `${untagged.length} posts in window aren't fully tagged`,
      detail: `${((untagged.length / posts.length) * 100).toFixed(
        0,
      )}% of posts in window have missing Theme, Pillar, or Tagging Status. Theme × Pillar cross-cuts under-represent these. Run the review queue in Ops → Tagging.`,
    });
  }

  // ── Finding 5: small-sample warning on the whole window ──────────────────
  if (posts.length < 10) {
    findings.unshift({
      id: "small-sample",
      severity: "warning",
      headline: `Small sample: ${posts.length} posts in window`,
      detail: `Per-cell averages are noisy below ~20 posts. Widen the date range or platform filter to draw conclusions.`,
    });
  }

  return findings.slice(0, 5);
}
