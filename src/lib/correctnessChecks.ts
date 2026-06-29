// Source-truth correctness invariants for the canonical Supabase social.* store
// (WEBDEV-288 Part 2). PURE — no DB/IO here; functions take already-fetched rows and
// return Violation[]. The monitor script (scripts/correctness-monitor.mjs) does the SQL
// + alerting. These checks must SURVIVE retiring the Airtable dual-write (WEBDEV-216):
// they validate Supabase against itself / hard invariants, not against another store.
//
// v1 is deliberately scoped to high-signal checks that PASS on the current known-good
// state and catch regressions. Correctness gaps the 2026-06-22 audit already filed
// (FB engagement_rate self-contradiction → WEBDEV-295; IG engagement/ER ~73% null →
// WEBDEV-296; Pinterest ER pre-2026-05-04 unrecoverable → WEBDEV-297 cancelled) are
// OWNED by those tickets and intentionally NOT failed here (see ALLOWLIST). Platform-API
// reconciliation is a later phase.

export type Severity = "fail" | "warn";
export interface Violation {
  check: string;
  severity: Severity;
  detail: string;
}

// Documentation of the gaps v1 deliberately does NOT fail on, each tied to a reason/ticket.
// (v1 checks are scoped to avoid these; the list is the audit trail + the seam for future
// checks that DO assert these once the owning ticket is fixed.)
export interface AllowEntry {
  table: string;
  platform?: string;
  metric: string;
  reason: string;
}
export const ALLOWLIST: AllowEntry[] = [
  // WEBDEV-295/296 FIXED (2026-06-29): content-grain ER writer deployed; the three
  // former entries (IG engagement, IG engagement_rate, FB engagement_rate) are now
  // ENFORCED by checkEngagementRateReproducible / checkNullSymmetry / checkIsPostDayConsistency.
  { table: "account_daily_facts", platform: "pinterest", metric: "engagement_rate<2026-05-04", reason: "unrecoverable aged tail (WEBDEV-297 cancelled)" },
  { table: "account_daily_facts", platform: "instagram", metric: "impressions", reason: "Meta deprecated IG account impressions (reach-only)" },
  { table: "account_daily_facts", platform: "instagram", metric: "views", reason: "not collected for IG account" },
  { table: "account_daily_facts", metric: "profile_views_30d|accounts_engaged_30d|interactions_30d|profile_links_taps_30d", reason: "unimplemented IG 30-day rollup scaffolding" },
  { table: "account_daily_facts", platform: "pinterest", metric: "follower_delta", reason: "Pinterest writer never computes it; delta=0" },
];

export interface FreshnessRow {
  table: string;
  ageHours: number | null; // hours since max(updated_at); null = no rows
}

export interface FactRow {
  table: string;
  platform: string;
  date: string; // YYYY-MM-DD
  reach: number | null;
  impressions: number | null;
  followers: number | null;
  engagement: number | null;
  engagement_rate: number | null;
  // WEBDEV-295/296 content-grain columns (FB+IG). content_reach is the ER denominator
  // (per-post reach sum); engagement_rate_followers is the co-primary ERF; is_post_day
  // flags whether a post was published that day. NULL on no-post days (never 0).
  content_reach: number | null;
  engagement_rate_followers: number | null;
  is_post_day: boolean;
}

// 1) Freshness / dead-writer: each live table updated within its window. The single
//    highest-value sweep — a stalled writer is an invisible data gap.
export function checkFreshness(
  rows: FreshnessRow[],
  maxAgeHours: Record<string, number>,
  defaultMax = 48,
): Violation[] {
  const out: Violation[] = [];
  for (const r of rows) {
    const limit = maxAgeHours[r.table] ?? defaultMax;
    if (r.ageHours === null) {
      out.push({ check: "freshness", severity: "fail", detail: `${r.table}: no rows / no updated_at` });
    } else if (r.ageHours > limit) {
      out.push({ check: "freshness", severity: "fail", detail: `${r.table}: stale ${r.ageHours.toFixed(1)}h (> ${limit}h) — writer may be dead` });
    }
  }
  return out;
}

// 2) engagement_rate must be a rate in [0,1] wherever present.
export function checkEngagementRateRange(rows: FactRow[]): Violation[] {
  const out: Violation[] = [];
  for (const r of rows) {
    if (r.engagement_rate != null && (r.engagement_rate < 0 || r.engagement_rate > 1)) {
      out.push({ check: "er-range", severity: "fail", detail: `${r.table} ${r.platform}|${r.date}: engagement_rate=${r.engagement_rate} outside [0,1]` });
    }
  }
  return out;
}

// 3) Counts are never negative.
export function checkNonNegative(rows: FactRow[]): Violation[] {
  const out: Violation[] = [];
  const cols: (keyof FactRow)[] = ["reach", "impressions", "followers", "engagement", "content_reach"];
  for (const r of rows) {
    for (const k of cols) {
      const v = r[k];
      if (typeof v === "number" && v < 0) {
        out.push({ check: "non-negative", severity: "fail", detail: `${r.table} ${r.platform}|${r.date}: ${k}=${v} < 0` });
      }
    }
  }
  return out;
}

// 4) No INTERIOR date gaps per platform (a missing day between two present days = a
//    skipped run). Trailing lag (e.g. IG a day behind) is NOT a gap — freshness covers
//    staleness — so this is robust to per-platform lag.
export function checkNoInteriorGaps(rows: FactRow[], platforms: string[]): Violation[] {
  const out: Violation[] = [];
  for (const p of platforms) {
    const dates = rows.filter((r) => r.platform === p).map((r) => r.date).sort();
    if (dates.length < 2) continue;
    const have = new Set(dates);
    for (const d of enumerateDates(dates[0], dates[dates.length - 1])) {
      if (!have.has(d)) {
        out.push({ check: "completeness", severity: "fail", detail: `account_daily_facts: missing ${p}|${d} (interior gap)` });
      }
    }
  }
  return out;
}

// 5) Core account metrics that every platform genuinely has (reach, followers) must be
//    non-null on present settled rows. (ER is intentionally excluded — see ALLOWLIST /
//    WEBDEV-295/296.) This catches the clobber/dead-writer class on the universal metrics.
export function checkCoreNonNull(rows: FactRow[]): Violation[] {
  const out: Violation[] = [];
  for (const r of rows) {
    if (r.reach == null) out.push({ check: "core-null", severity: "fail", detail: `account_daily_facts: reach NULL at ${r.platform}|${r.date}` });
    if (r.followers == null) out.push({ check: "core-null", severity: "fail", detail: `account_daily_facts: followers NULL at ${r.platform}|${r.date}` });
  }
  return out;
}

// ---------------------------------------------------------------------------
// WEBDEV-295/296 content-grain engagement invariants (scope: facebook + instagram).
// Pinterest is excluded — it has its own native ER and no content_reach. These ENFORCE
// what the new Social Data Refresher writer guarantees; they REPLACE the former
// allowlist entries for IG engagement / IG ER / FB ER.
// ---------------------------------------------------------------------------
const FBIG = new Set(["facebook", "instagram"]);
// Match the writer + history repair: ER columns are numeric(_,4), values rounded to 4dp.
const round4 = (v: number): number => Math.round(v * 1e4) / 1e4;
const REPRO_EPS = 1e-9; // both sides are 4dp; epsilon only absorbs float representation.

// 6) Content-grain ER reproducible at 4dp: engagement_rate == round(engagement/content_reach, 4)
//    when content_reach>0 and both engagement & ER are present.
export function checkEngagementRateReproducible(rows: FactRow[]): Violation[] {
  const out: Violation[] = [];
  for (const r of rows) {
    if (!FBIG.has(r.platform)) continue;
    if (r.engagement == null || r.engagement_rate == null || r.content_reach == null || r.content_reach <= 0) continue;
    const expected = round4(r.engagement / r.content_reach);
    if (Math.abs(r.engagement_rate - expected) > REPRO_EPS) {
      out.push({ check: "er-reproducible", severity: "fail", detail: `account_daily_facts ${r.platform}|${r.date}: engagement_rate=${r.engagement_rate} != round(engagement/content_reach,4)=${expected}` });
    }
  }
  return out;
}

// 7) Co-primary ERF reproducible at 4dp: engagement_rate_followers == round(engagement/followers, 4)
//    when followers>0 and both engagement & ERF are present. ERF being NULL is allowed
//    (an independent denominator — a follower-fetch gap legitimately nulls it), so this
//    check only fires on a PRESENT-but-WRONG ERF, never on a missing one.
export function checkErfReproducible(rows: FactRow[]): Violation[] {
  const out: Violation[] = [];
  for (const r of rows) {
    if (!FBIG.has(r.platform)) continue;
    if (r.engagement == null || r.engagement_rate_followers == null || r.followers == null || r.followers <= 0) continue;
    const expected = round4(r.engagement / r.followers);
    if (Math.abs(r.engagement_rate_followers - expected) > REPRO_EPS) {
      out.push({ check: "erf-reproducible", severity: "fail", detail: `account_daily_facts ${r.platform}|${r.date}: engagement_rate_followers=${r.engagement_rate_followers} != round(engagement/followers,4)=${expected}` });
    }
  }
  return out;
}

// 8) Null-symmetry: engagement / content_reach / engagement_rate go NULL or non-NULL
//    together (zero-vs-missing honesty). engagement & content_reach are computed from the
//    same per-post source so they are always paired. engagement_rate pairs with them too,
//    EXCEPT the degenerate content_reach=0 (ER is undefined → legitimately NULL).
//    engagement_rate_followers is deliberately NOT in this group (independent denominator).
export function checkNullSymmetry(rows: FactRow[]): Violation[] {
  const out: Violation[] = [];
  for (const r of rows) {
    if (!FBIG.has(r.platform)) continue;
    const eNull = r.engagement == null;
    const crNull = r.content_reach == null;
    const erNull = r.engagement_rate == null;
    if (eNull !== crNull) {
      out.push({ check: "null-symmetry", severity: "fail", detail: `account_daily_facts ${r.platform}|${r.date}: engagement ${eNull ? "NULL" : "set"} but content_reach ${crNull ? "NULL" : "set"}` });
      continue;
    }
    if (erNull !== eNull && r.content_reach !== 0) {
      out.push({ check: "null-symmetry", severity: "fail", detail: `account_daily_facts ${r.platform}|${r.date}: engagement_rate ${erNull ? "NULL" : "set"} disagrees with engagement ${eNull ? "NULL" : "set"}` });
    }
  }
  return out;
}

// 9) is_post_day consistency: is_post_day === (engagement IS NOT NULL).
export function checkIsPostDayConsistency(rows: FactRow[]): Violation[] {
  const out: Violation[] = [];
  for (const r of rows) {
    if (!FBIG.has(r.platform)) continue;
    const expected = r.engagement != null;
    if (r.is_post_day !== expected) {
      out.push({ check: "is-post-day", severity: "fail", detail: `account_daily_facts ${r.platform}|${r.date}: is_post_day=${r.is_post_day} but engagement ${expected ? "set" : "NULL"}` });
    }
  }
  return out;
}

export function enumerateDates(start: string, end: string): string[] {
  const out: string[] = [];
  let d = Date.parse(start + "T00:00:00Z");
  const last = Date.parse(end + "T00:00:00Z");
  while (d <= last) {
    out.push(new Date(d).toISOString().slice(0, 10));
    d += 86_400_000;
  }
  return out;
}

// Aggregate runner used by the monitor.
export function runAllChecks(input: {
  freshness: FreshnessRow[];
  facts: FactRow[];
  freshnessMaxAgeHours: Record<string, number>;
  platforms: string[];
}): Violation[] {
  return [
    ...checkFreshness(input.freshness, input.freshnessMaxAgeHours),
    ...checkEngagementRateRange(input.facts),
    ...checkNonNegative(input.facts),
    ...checkNoInteriorGaps(input.facts, input.platforms),
    ...checkCoreNonNull(input.facts),
    ...checkEngagementRateReproducible(input.facts),
    ...checkErfReproducible(input.facts),
    ...checkNullSymmetry(input.facts),
    ...checkIsPostDayConsistency(input.facts),
  ];
}
