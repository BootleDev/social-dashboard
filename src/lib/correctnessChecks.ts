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
  // WEBDEV-367: IG account Views IS now collected (replacement for the retired IG
  // account impressions), but ONLY as a 30-day rolling aggregate written to the
  // NEWEST IG row (views_source='period_aggregate') — never a per-day series. So no
  // check asserts per-day / summable views on every IG row; it is surfaced as a
  // latest-row 30d figure. Kept here to document the seam and forbid a future
  // per-day views invariant.
  { table: "account_daily_facts", platform: "instagram", metric: "views", reason: "IG Views is a newest-row-only 30-day aggregate (period_aggregate), not per-day — intentionally not asserted per-day/summable" },
  { table: "account_daily_facts", metric: "profile_views_30d|accounts_engaged_30d|interactions_30d|profile_links_taps_30d", reason: "unimplemented IG 30-day rollup scaffolding" },
  { table: "account_daily_facts", platform: "pinterest", metric: "follower_delta", reason: "Pinterest writer never computes it; delta=0" },
  // WEBDEV-535: TikTok exposes NO account-level reach. The TikTok Data Refresher sources
  // from ScrapeCreators, whose profile endpoint returns only stats.followerCount — there is
  // no reach/impressions figure to fetch at any price (real TikTok account reach requires
  // the TikTok Business API, which Bootle is not on). So the NULL is HONEST, not a dead
  // writer, and checkCoreNonNull must not assert reach for it. followers IS asserted (below)
  // — that's the column that would actually go NULL if the TikTok writer died.
  { table: "account_daily_facts", platform: "tiktok", metric: "reach", reason: "TikTok exposes no account-level reach (ScrapeCreators profile = followers only; needs TikTok Business API)" },
];

// Platforms whose account-level `reach` is structurally unavailable, derived from the
// ALLOWLIST so the exemption has exactly one source of truth: to exempt a platform you must
// add a reasoned ALLOWLIST entry, and deleting that entry re-arms the check automatically.
const REACH_UNAVAILABLE: Set<string> = new Set(
  ALLOWLIST.filter((a) => a.table === "account_daily_facts" && a.metric === "reach" && a.platform).map(
    (a) => a.platform as string,
  ),
);

// ---------------------------------------------------------------------------
// WEBDEV-536 — per-platform settle windows.
//
// The Social Data Refresher marks a row `settled` only once it is OLDER than that
// platform's settle window (WEBDEV-352): FB=3d, IG=21d (IG Reels engagement genuinely
// accrues for weeks). The monitor previously selected settled rows with ONE fixed band
// for all platforms (today-16 .. today-3) — which an IG row can NEVER satisfy: it is not
// settled until it is >21d old, by which point it is already past the 16d ceiling. The two
// windows do not intersect, so Instagram silently contributed ZERO rows and every IG
// invariant passed vacuously while the monitor reported PASS.
//
// So the checked window is now derived PER PLATFORM from the same settle constants. These
// mirror the writer's FB_SETTLE_DAYS / IG_SETTLE_DAYS; they are duplicated across repo
// boundaries (the writer is an n8n Code node), which is exactly the drift that caused this
// bug — so checkPlatformCoverage() below fails LOUD if any platform stops landing rows in
// its window, whatever the reason. That guard, not this table, is the real protection.
// ---------------------------------------------------------------------------
export const SETTLE_DAYS_BY_PLATFORM: Record<string, number> = {
  instagram: 21,
  facebook: 3,
  pinterest: 3,
  tiktok: 3,
};
export const DEFAULT_SETTLE_DAYS = 3;
/** How many days wide the checked band is, once offset past the platform's settle window. */
export const CHECK_WINDOW_SPAN_DAYS = 14;

export function settleDaysFor(platform: string): number {
  return SETTLE_DAYS_BY_PLATFORM[platform] ?? DEFAULT_SETTLE_DAYS;
}

/**
 * The inclusive [minAgeDays, maxAgeDays] band this platform's rows are checked in.
 * A row is only `settled` at age > settle, so the band starts at settle+1.
 */
export function checkWindowFor(platform: string): { minAgeDays: number; maxAgeDays: number } {
  const settle = settleDaysFor(platform);
  return { minAgeDays: settle + 1, maxAgeDays: settle + CHECK_WINDOW_SPAN_DAYS };
}

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

// WEBDEV-288 Part B — one raw per-day reach value pulled straight from the platform API
// (Meta Graph: IG insights `reach`; FB `page_total_media_view_unique` proxy). The monitor
// script fetches these; the pure check below compares them to the stored canonical reach.
export interface ApiReachRow {
  platform: string;
  date: string; // YYYY-MM-DD
  reach: number | null;
}

// Reconciliation materiality thresholds. Tuned to catch WRITER-class bugs (wrong metric,
// bad transform, a zeroed/clobbered column) — which produce large divergence — while
// tolerating small platform restatements (typically <5%), so the check doesn't fire on
// benign late-settling. A violation requires BOTH thresholds crossed.
export const RECON_REL_TOL = 0.25; // >25% relative divergence
export const RECON_ABS_FLOOR = 5; // ...AND >5 absolute (avoid tiny-number noise)

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
//    `reach` is asserted for every platform EXCEPT those in REACH_UNAVAILABLE (WEBDEV-535),
//    where no such metric exists at the source; `followers` is asserted for ALL platforms,
//    including those, so a dead writer still fails loudly.
export function checkCoreNonNull(rows: FactRow[]): Violation[] {
  const out: Violation[] = [];
  for (const r of rows) {
    if (r.reach == null && !REACH_UNAVAILABLE.has(r.platform)) out.push({ check: "core-null", severity: "fail", detail: `account_daily_facts: reach NULL at ${r.platform}|${r.date}` });
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

// ---------------------------------------------------------------------------
// WEBDEV-536 — the two guards that make the monitor honest about its own coverage.
// A monitor that silently checks NOTHING and reports PASS is worse than no monitor:
// it manufactures false confidence. These two checks make "I am not looking at X"
// a LOUD failure instead of an invisible one.
// ---------------------------------------------------------------------------

/** Hours since this platform's most recent write to account_daily_facts. */
export interface PlatformFreshnessRow {
  platform: string;
  ageHours: number | null; // null = platform has no rows at all
}

/**
 * 11) PER-PLATFORM freshness / dead-writer.
 *
 * checkFreshness() takes ONE max(updated_at) over the whole table — and
 * account_daily_facts has FOUR writers landing in it. So any one writer could die and the
 * other three would keep the table's freshness green forever; the dead one is invisible.
 * (Confirmed on the WEBDEV-535 review: a fully dead TikTok writer fired NO check at all.)
 * Per-platform freshness is the check that actually catches a dead writer.
 */
export function checkPlatformFreshness(rows: PlatformFreshnessRow[], maxAgeHours = 48): Violation[] {
  const out: Violation[] = [];
  for (const r of rows) {
    if (r.ageHours === null) {
      out.push({ check: "platform-freshness", severity: "fail", detail: `account_daily_facts: platform ${r.platform} has no rows at all` });
    } else if (r.ageHours > maxAgeHours) {
      out.push({ check: "platform-freshness", severity: "fail", detail: `account_daily_facts: ${r.platform} stale ${r.ageHours.toFixed(1)}h (> ${maxAgeHours}h) — that platform's writer may be dead (the other writers keep the TABLE fresh, so table-level freshness cannot see this)` });
    }
  }
  return out;
}

/**
 * 12) COVERAGE: every platform that is live in the table must actually contribute rows to
 *     the checked window. This is the guard that would have caught WEBDEV-536 on day one:
 *     Instagram's 21d settle window vs the old fixed 3-16d check band meant IG could never
 *     be checked, so every IG invariant passed vacuously and the monitor said PASS.
 *
 *     Fails LOUD whenever a platform silently drops out of coverage — whatever the cause
 *     (a settle-window change, a band change, a writer that stopped, a renamed platform).
 */
export function checkPlatformCoverage(livePlatforms: string[], checkedRows: FactRow[]): Violation[] {
  const out: Violation[] = [];
  const checked = new Set(checkedRows.map((r) => r.platform));
  for (const p of livePlatforms) {
    if (!checked.has(p)) {
      const w = checkWindowFor(p);
      out.push({
        check: "coverage",
        severity: "fail",
        detail: `account_daily_facts: ${p} has live rows but contributed ZERO rows to the checked window (settled, age ${w.minAgeDays}-${w.maxAgeDays}d) — the monitor is BLIND to this platform; its invariants are passing vacuously`,
      });
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

// 10) Platform-API reconciliation (WEBDEV-288 Part B): the only check that pulls the
//     SOURCE of truth (the platform API), catching "both stores wrong the same way" —
//     a writer that stored a wrong/transformed reach is parity-blind and invariant-blind
//     (the row can be internally consistent yet wrong vs the platform). FB+IG only;
//     materiality-gated; compares only (platform,date) pairs present in BOTH sides.
export function checkPlatformApiReconciliation(
  facts: FactRow[],
  apiReach: ApiReachRow[],
  relTol = RECON_REL_TOL,
  absFloor = RECON_ABS_FLOOR,
): Violation[] {
  const out: Violation[] = [];
  const api = new Map<string, number>();
  for (const r of apiReach) {
    if (r.reach != null) api.set(`${r.platform}|${r.date}`, r.reach);
  }
  for (const f of facts) {
    if (f.platform !== "facebook" && f.platform !== "instagram") continue;
    if (f.reach == null) continue; // genuine/allowlisted null — not this check's call
    const a = api.get(`${f.platform}|${f.date}`);
    if (a == null) continue; // API has no value for that day (availability) — skip
    const diff = Math.abs(f.reach - a);
    const rel = a > 0 ? diff / a : diff > 0 ? 1 : 0;
    if (diff > absFloor && rel > relTol) {
      const src = f.platform === "facebook" ? "FB page_total_media_view_unique" : "IG insights reach";
      out.push({
        check: "platform-reconciliation",
        severity: "fail",
        detail: `${f.platform} ${f.date}: stored reach ${f.reach} vs ${src} API ${a} (${(rel * 100).toFixed(0)}% divergence > ${(relTol * 100).toFixed(0)}%) — canonical store disagrees with the platform (parity- & invariant-blind).`,
      });
    }
  }
  return out;
}

// Aggregate runner used by the monitor. apiReach is optional: when the monitor has no
// platform token (or the fetch was skipped) it passes [] and reconciliation is a no-op,
// so the rest of the monitor still runs.
export function runAllChecks(input: {
  freshness: FreshnessRow[];
  facts: FactRow[];
  freshnessMaxAgeHours: Record<string, number>;
  platforms: string[];
  apiReach?: ApiReachRow[];
  // WEBDEV-536. Optional so existing callers/tests keep working; when the monitor supplies
  // them, the coverage + per-platform-freshness guards run.
  platformFreshness?: PlatformFreshnessRow[];
  livePlatforms?: string[];
}): Violation[] {
  return [
    ...checkFreshness(input.freshness, input.freshnessMaxAgeHours),
    ...checkPlatformFreshness(input.platformFreshness ?? []),
    ...checkPlatformCoverage(input.livePlatforms ?? [], input.facts),
    ...checkEngagementRateRange(input.facts),
    ...checkNonNegative(input.facts),
    ...checkNoInteriorGaps(input.facts, input.platforms),
    ...checkCoreNonNull(input.facts),
    ...checkEngagementRateReproducible(input.facts),
    ...checkErfReproducible(input.facts),
    ...checkNullSymmetry(input.facts),
    ...checkIsPostDayConsistency(input.facts),
    ...checkPlatformApiReconciliation(input.facts, input.apiReach ?? []),
  ];
}
