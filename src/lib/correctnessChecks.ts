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
  { table: "account_daily_facts", platform: "instagram", metric: "engagement", reason: "WEBDEV-296 IG account engagement ~73% null" },
  { table: "account_daily_facts", platform: "instagram", metric: "engagement_rate", reason: "WEBDEV-296 (derives from engagement)" },
  { table: "account_daily_facts", platform: "facebook", metric: "engagement_rate", reason: "WEBDEV-295 FB ER not row-reproducible; null on zero-engagement days" },
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
  const cols: (keyof FactRow)[] = ["reach", "impressions", "followers", "engagement"];
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
  ];
}
