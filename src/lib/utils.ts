import { platformSortOrder } from "./platforms";

export type Fields = Record<string, unknown>;

export type AirtableRecord = {
  id: string;
  fields: Fields;
  createdTime: string;
};

/**
 * Parse an Airtable cell to a finite number, defaulting to 0.
 *
 * Rejects NaN and ±Infinity (returns 0) so a single corrupt value can't
 * poison a downstream sum or average — `parseFloat("1e999")` is `Infinity`,
 * `Number("Infinity")` is `Infinity`, and both would otherwise propagate
 * through sumReach/avgField and read as an `Infinity` KPI. Negatives are
 * passed through because some legitimate fields are signed (e.g. Followers
 * Gained can be net-negative); count-style fields that must be non-negative
 * should be read via `count()` instead.
 */
export function num(val: unknown): number {
  if (typeof val === "number") return Number.isFinite(val) ? val : 0;
  if (typeof val === "string") {
    const parsed = parseFloat(val);
    return Number.isFinite(parsed) ? parsed : 0;
  }
  return 0;
}

/**
 * Parse a count metric (reach, engagement, impressions, likes, saves, shares,
 * comments, video views, link clicks, followers) to a non-negative integer.
 *
 * These are tallies — they cannot be fractional or negative. A negative value
 * is a data error (bad upstream delta, sign flip) and clamps to 0 rather than
 * dragging a sum down; a fractional value is floored. Built on `num()`, so it
 * inherits the NaN/Infinity rejection. Use this for any field that feeds a
 * reach or engagement total on the Pulse tab.
 */
export function count(val: unknown): number {
  const n = num(val);
  return n > 0 ? Math.floor(n) : 0;
}

/**
 * Parse a non-negative metric that may legitimately be FRACTIONAL — e.g. Meta's
 * modeled/attributed ad conversions (pixel + CAPI + modeled), which Ads Manager
 * reports as decimals (12.7 purchases). Unlike `count()`, this does NOT floor:
 * flooring would drop the fractional part on every row and zero any row with
 * <1 modeled conversion (0.6 → 0), biasing conversion counts downward — which
 * deflates CVR and, because purchase VALUE keeps its decimals, inflates AOV.
 *
 * Clamps negatives to 0 (a negative conversion count is a data error) and
 * inherits num()'s NaN/Infinity rejection. Use for ad-attributed purchase
 * counts; use `count()` only for genuine integer tallies (clicks, impressions,
 * orders, social engagement).
 */
export function numNonNeg(val: unknown): number {
  const n = num(val);
  return n > 0 ? n : 0;
}

export function str(val: unknown): string {
  if (typeof val === "string") return val;
  return String(val ?? "");
}

/**
 * Reach for a raw post record, accounting for Pinterest having no reach metric.
 *
 * Pinterest's API reports Impressions but not Reach, so the "Reach" field is
 * structurally 0 on every Pinterest row while Impressions are populated. We
 * substitute Impressions as Pinterest's reach-equivalent. All other platforms
 * pass their real Reach through unchanged. Mirrors `effectiveReach` in
 * derivedMetrics.ts (which operates on the parsed Post shape); kept here so
 * display components can use it without converting to Post first.
 */
export function recordReach(record: AirtableRecord): number {
  const platform = str(record.fields["Platform"]).toLowerCase().trim();
  if (platform === "pinterest") {
    const impressions = count(record.fields["Impressions"]);
    return impressions > 0 ? impressions : count(record.fields["Reach"]);
  }
  return count(record.fields["Reach"]);
}

/**
 * ER Type values on Daily Account Metrics rows whose account-level Impressions
 * and Reach are SYNTHESIZED, not measured. Instagram retired the account-level
 * impressions metric, so the Social Data Refresher backfills these rows by
 * deriving from per-post data (`posts_derived_daily`) or carrying a period
 * average (`period_average`). The derived account-level Impressions/Reach on
 * such rows is a placeholder (observed: a flat 299 across consecutive IG days),
 * so summing it into a Pulse KPI reports a fabricated total. Only rows tagged
 * `daily` carry a genuine same-day account-level measurement.
 *
 * This does NOT taint Engagement Rate on these rows — the derived ER is the
 * intended value. It only marks the volume counts (Impressions/Reach) as
 * non-authoritative for headline totals.
 */
const DERIVED_ACCOUNT_METRIC_ER_TYPES = new Set([
  "posts_derived_daily",
  "period_average",
]);

/**
 * Per-metric Source values (WEBDEV-146) that mark a value safe to sum into a
 * per-day window total:
 *  - `daily_real`  — a real same-day platform measurement (Meta IG/FB).
 *  - `pin_sum`     — Pinterest's account reach/impressions, defined as the sum
 *                    of that day's pin impressions (MARKETING-35). Pinterest has
 *                    no deduplicated account reach, so this IS its account
 *                    distribution figure; it is tagged distinctly so it is never
 *                    confused with a Meta-style measurement, but it is real and
 *                    summable per day.
 * `daily_proxy` is a Facebook account-REACH-only proxy and is handled
 * SEPARATELY in hasRealMetricSource (deliberately NOT in this set): from
 * 2026-06-20 the Graph API publishes no deduplicated FB account reach, so reach
 * is proxied by `page_total_media_view_unique` (unique users who viewed page
 * content — the same metric backing FB account impressions). It is summable for
 * REACH only; counting it as impressions would double-count, since FB
 * impressions are already `daily_real` with the same underlying value. Disclosed
 * as a proxy on the Methodology page.
 *
 * Other Source values are NOT real per-day volume: `null` (honestly absent, e.g.
 * IG has no per-day Impressions), `period_aggregate` (a labelled window total,
 * never per-day), `pending`/`settled` (late-settling lifecycle markers).
 */
const REAL_PER_DAY_VOLUME_SOURCES = new Set(["daily_real", "pin_sum"]);

/**
 * True when a SPECIFIC metric's per-day value on an account row is a real,
 * summable measurement, false when it is honestly absent or a non-per-day total.
 *
 * Per-metric (not row-level): an Instagram fact row is real for Reach but absent
 * for Impressions; a Facebook row is the reverse. Judging volume at the row
 * level would let one real metric drag the other into a headline sum as 0.
 *
 * Two data shapes during the WEBDEV-146 migration:
 *  - Account Daily Facts rows carry explicit per-metric Source columns; they are
 *    authoritative. Real iff the named Source is in REAL_PER_DAY_VOLUME_SOURCES.
 *  - Legacy Daily Account Metrics rows have no Source columns; fall back to the
 *    overloaded `ER Type` denylist (rows with no ER Type predate tagging → real).
 */
function hasRealMetricSource(
  record: AirtableRecord,
  sourceField: "Reach Source" | "Impressions Source",
): boolean {
  const source = str(record.fields[sourceField]).trim();
  if (source.length > 0) {
    // daily_proxy is a Facebook REACH-only proxy (page_total_media_view_unique,
    // from 2026-06-20): summable for reach, but NEVER counted as impressions —
    // FB impressions are already daily_real with the same underlying value, so
    // treating daily_proxy as impressions would double-count.
    if (source === "daily_proxy") return sourceField === "Reach Source";
    return REAL_PER_DAY_VOLUME_SOURCES.has(source);
  }

  // WEBDEV-537. Below here is the LEGACY fallback, and it must only ever apply to
  // LEGACY-shaped rows. An account_daily_facts row carries explicit per-metric Source
  // columns, so on THAT shape an absent Source means "no such metric here" — honest
  // absence — and must render as an em-dash, never be summed as 0.
  //
  // The bug this fixes: account_daily_facts rows never carry an "ER Type" column at all
  // (it isn't in ACCOUNT_DAILY_FACTS_MAP), so `if (!erType) return true` fired for every
  // ADF row with an unset Source. TikTok is the only platform whose reach_source is SQL
  // NULL (it has no account-level reach at source — WEBDEV-535), so its NULL reach was
  // being counted as "real", summed, and rendered as **"Reach: 0"** — precisely what
  // hasRealAccountVolume's docstring says this mechanism exists to prevent.
  //
  // Discriminator: "Snapshot Key" is present on EVERY account_daily_facts row (it is the
  // upsert conflict key — verified 277/277 non-null in prod) and on NO legacy Daily
  // Account Metrics row (not in DAILY_MAP). hasRealViews() already treats an absent
  // source as not-real; this brings reach/impressions in line.
  const isAccountDailyFactsRow = str(record.fields["Snapshot Key"]).trim().length > 0;
  if (isAccountDailyFactsRow) return false;

  const erType = str(record.fields["ER Type"]).trim();
  if (!erType) return true;
  return !DERIVED_ACCOUNT_METRIC_ER_TYPES.has(erType);
}

/** True when this row's per-day Reach is a real, summable measurement. */
export function hasRealReach(record: AirtableRecord): boolean {
  return hasRealMetricSource(record, "Reach Source");
}

/** True when this row's per-day Impressions is a real, summable measurement. */
export function hasRealImpressions(record: AirtableRecord): boolean {
  return hasRealMetricSource(record, "Impressions Source");
}

/**
 * True when a row carries a REAL Views value (WEBDEV-367). Instagram's account
 * Views is Meta's replacement for the retired account-level impressions metric,
 * but Meta exposes it ONLY as a rolling 30-day aggregate written to the newest IG
 * row (`views_source = 'period_aggregate'`), never a per-day series.
 *
 * This is deliberately a SEPARATE check from hasRealReach / hasRealImpressions:
 * those gate per-day *summable* volume via REAL_PER_DAY_VOLUME_SOURCES, and Views
 * must never be summed across day-rows. `period_aggregate` is intentionally NOT
 * in REAL_PER_DAY_VOLUME_SOURCES for exactly this reason. A Views value is "real"
 * (surfaceable, taken from the newest row) when its Source is present and is not
 * the honest-absence placeholder — `period_aggregate` is the current real source.
 * An absent / `"null"` / empty Source renders as an em-dash, never a zero.
 */
export function hasRealViews(record: AirtableRecord): boolean {
  const source = str(record.fields["Views Source"]).trim();
  if (source.length === 0) return false;
  if (source === "null") return false;
  return true;
}

/**
 * True when an account row carries real per-day volume for AT LEAST ONE of
 * Reach/Impressions. Kept for callers that only need a coarse row-level check;
 * per-metric pills and headline sums use {@link hasRealReach} /
 * {@link hasRealImpressions} so a metric absent on a platform is omitted rather
 * than summed as 0.
 */
export function hasRealAccountVolume(record: AirtableRecord): boolean {
  return hasRealReach(record) || hasRealImpressions(record);
}

export function formatNumber(value: number): string {
  if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(1)}M`;
  if (value >= 1_000) return `${(value / 1_000).toFixed(1)}K`;
  return value.toFixed(0);
}

export function formatPercent(value: number, decimals = 1): string {
  return `${value.toFixed(decimals)}%`;
}

export function pctChange(
  current: number,
  previous: number,
): number | undefined {
  if (previous === 0) return undefined;
  return ((current - previous) / previous) * 100;
}

/**
 * A percentage change that is only returned when it is statistically
 * meaningful — i.e. the prior-period base is large enough to be a trustworthy
 * denominator AND the absolute swing is large enough to matter. Otherwise
 * returns undefined.
 *
 * This guards the "X% vs prior period" lines (e.g. the "Needs attention"
 * biggest-mover) against small-denominator artifacts: a window that went from
 * 15 to 545 reach is +3533%, which is mathematically real but analytically
 * noise — the prior base is too small to anchor a percentage. Callers should
 * treat undefined as "no significant move to report" rather than "no data".
 *
 * Floors default to a conservative reach-scale base; pass `opts` to tune for a
 * different metric. A change still returns undefined when previous is 0 (no
 * denominator), matching pctChange.
 */
export function significantPctChange(
  current: number,
  previous: number,
  opts: { minBase?: number; minAbsDelta?: number } = {},
): number | undefined {
  const { minBase = 50, minAbsDelta = 50 } = opts;
  if (previous < minBase) return undefined;
  if (Math.abs(current - previous) < minAbsDelta) return undefined;
  return pctChange(current, previous);
}

/**
 * Period-over-period reach change that is robust to differing window coverage.
 *
 * Comparing a current-window reach SUM to a prior-window reach SUM is only
 * valid when both windows cover a comparable number of days. When the prior
 * window is sparse (e.g. account-fact rows only exist for 2 of its 30 days), a
 * sum-vs-sum ratio invents an explosive percentage (the real "Instagram reach
 * up 3545%" bug: 26 measured days vs 2). The honest comparison is per-day
 * AVERAGE reach, with two guards:
 *   - both windows must have at least `minDays` measured days, and
 *   - their coverage must not be more lopsided than `maxCoverageRatio`,
 * so we never compare a dense window against a near-empty one.
 *
 * Returns the percent change in average daily reach, or undefined when the
 * comparison is not trustworthy or the move is below `minRelMove` (relative).
 */
export function windowReachChange(
  curSum: number,
  curDays: number,
  prevSum: number,
  prevDays: number,
  opts: {
    minDays?: number;
    maxCoverageRatio?: number;
    minRelMove?: number;
  } = {},
): number | undefined {
  const { minDays = 5, maxCoverageRatio = 3, minRelMove = 5 } = opts;
  if (curDays < minDays || prevDays < minDays) return undefined;
  // Guard the per-day division even if a caller passes minDays: 0.
  if (curDays <= 0 || prevDays <= 0) return undefined;

  const coverageRatio =
    Math.max(curDays, prevDays) / Math.min(curDays, prevDays);
  if (coverageRatio > maxCoverageRatio) return undefined;

  const curAvg = curSum / curDays;
  const prevAvg = prevSum / prevDays;
  const change = pctChange(curAvg, prevAvg);
  if (change === undefined) return undefined;
  if (Math.abs(change) < minRelMove) return undefined;
  return change;
}

/**
 * Generic aggregator: groups records by a key extractor and averages a metric.
 * Returns results sorted descending by avg, skipping records where getMetric
 * returns undefined (missing data).
 */
/**
 * Drop the trailing date from a unified-date series if every series has a
 * zero/null value on it. Meta's daily metrics often haven't reported yet for
 * "today" by the time our cron runs — a zero on the final day is almost
 * always a partial-data artifact, not a real zero. Returns a new dates array
 * (the caller is expected to align their series to the same new array).
 */
export function trimTrailingZeroDay(
  dates: string[],
  seriesValues: Array<Array<number | null>>,
): string[] {
  if (dates.length === 0) return dates;
  const lastIdx = dates.length - 1;
  const allZeroOrNull = seriesValues.every((s) => {
    const v = s[lastIdx];
    return v === null || v === undefined || v === 0;
  });
  return allZeroOrNull ? dates.slice(0, -1) : dates;
}

export function groupByDimension<T extends AirtableRecord>(
  records: T[],
  getKey: (r: T) => string,
  getMetric: (r: T) => number | undefined,
): Array<{ label: string; avg: number; count: number }> {
  const groups = new Map<string, { total: number; count: number }>();

  for (const r of records) {
    const key = getKey(r) || "untagged";
    const metric = getMetric(r);
    if (metric === undefined) continue;
    const existing = groups.get(key) ?? { total: 0, count: 0 };
    groups.set(key, { total: existing.total + metric, count: existing.count + 1 });
  }

  return Array.from(groups.entries())
    .map(([label, { total, count }]) => ({
      label,
      avg: count > 0 ? total / count : 0,
      count,
    }))
    .sort((a, b) => b.avg - a.avg);
}

export type TimeBucket = "Morning" | "Midday" | "Evening" | "Night";

/** Derive time-of-day bucket from an ISO date string (UTC hours). */
export function timeBucket(publishedAt: string): TimeBucket {
  const d = new Date(publishedAt);
  if (isNaN(d.getTime())) return "Night";
  const hour = d.getUTCHours();
  if (hour >= 6 && hour < 12) return "Morning";
  if (hour >= 12 && hour < 17) return "Midday";
  if (hour >= 17 && hour < 22) return "Evening";
  return "Night";
}

const DOW = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"] as const;

/** Derive day-of-week label from an ISO date string (UTC). */
export function dayOfWeek(publishedAt: string): string {
  const d = new Date(publishedAt);
  if (isNaN(d.getTime())) return "Unknown";
  return DOW[d.getUTCDay()];
}

/**
 * Timezone-aware date/time helpers added 2026-05-26 for the "when should I
 * post" workflow. All helpers accept an IANA timezone string (e.g.
 * "Europe/London", "America/New_York"); pass `undefined` for browser-local.
 */

/**
 * Normalize a timezone arg: empty string or undefined becomes undefined so
 * Intl.DateTimeFormat falls back to browser-local. Passing `""` directly to
 * `timeZone:` throws a RangeError ("Invalid time zone specified").
 */
function normalizeTz(timezone?: string): string | undefined {
  return timezone && timezone.length > 0 ? timezone : undefined;
}

/** Format an ISO timestamp as YYYY-MM-DD in the given IANA timezone. */
export function formatLocalDate(iso: string, timezone?: string): string {
  const d = new Date(iso);
  if (isNaN(d.getTime())) return "";
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: normalizeTz(timezone),
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(d);
  // en-CA returns YYYY-MM-DD which is the format we want.
  return parts;
}

/** Format an ISO timestamp as "YYYY-MM-DD HH:mm" in the given IANA timezone. */
export function formatLocalDateTime(iso: string, timezone?: string): string {
  const d = new Date(iso);
  if (isNaN(d.getTime())) return "";
  // Two-pass to avoid locale-mixed output: build date, then time.
  const date = formatLocalDate(iso, timezone);
  const time = new Intl.DateTimeFormat("en-GB", {
    timeZone: normalizeTz(timezone),
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(d);
  return `${date} ${time}`;
}

/** Day-of-week label (Sun..Sat) in the given IANA timezone. */
export function dayOfWeekLocal(iso: string, timezone?: string): string {
  const d = new Date(iso);
  if (isNaN(d.getTime())) return "Unknown";
  // Use weekday short to get e.g. "Mon", "Tue".
  return new Intl.DateTimeFormat("en-US", {
    timeZone: normalizeTz(timezone),
    weekday: "short",
  }).format(d);
}

/** Hour (0-23) of the day in the given IANA timezone. */
export function hourOfDayLocal(iso: string, timezone?: string): number {
  const d = new Date(iso);
  if (isNaN(d.getTime())) return -1;
  const hourStr = new Intl.DateTimeFormat("en-GB", {
    timeZone: normalizeTz(timezone),
    hour: "2-digit",
    hour12: false,
  }).format(d);
  return parseInt(hourStr, 10);
}

/**
 * Day-parts, in chronological order, used as a coarse alternative to the 24
 * hour-of-day columns in the posting heatmap. Bucketing into ~5 parts lets a
 * low-volume account (e.g. 42 posts) accumulate enough posts per slot to read
 * a "best time" signal, where a 24-column grid would leave every cell at n<2.
 */
export const DAY_PARTS = [
  "Night",
  "Morning",
  "Midday",
  "Afternoon",
  "Evening",
] as const;

export type DayPart = (typeof DAY_PARTS)[number];

/**
 * Map a 0-23 hour to its day-part. Accepts 24 (a midnight rollover from some
 * formatters) as Night. Returns null for an out-of-range hour so callers can
 * skip it rather than mis-bucket.
 */
export function dayPartOfHour(hour: number): DayPart | null {
  if (!Number.isFinite(hour)) return null;
  const h = hour === 24 ? 0 : hour;
  if (h < 0 || h > 23) return null;
  if (h <= 5) return "Night"; // 00:00-05:59
  if (h <= 10) return "Morning"; // 06:00-10:59
  if (h <= 13) return "Midday"; // 11:00-13:59
  if (h <= 17) return "Afternoon"; // 14:00-17:59
  return "Evening"; // 18:00-23:59
}

/**
 * List of presets shown in the timezone selector. Order matters — selector
 * renders them in this order.
 */
export const TIMEZONE_PRESETS = [
  { label: "Browser local", value: "" },
  { label: "London (UK/EU)", value: "Europe/London" },
  { label: "Stockholm (CET/CEST)", value: "Europe/Stockholm" },
  { label: "New York", value: "America/New_York" },
  { label: "Los Angeles", value: "America/Los_Angeles" },
  { label: "UTC", value: "UTC" },
] as const;

/** Aggregate posts by post type, returning avg ER for each type. */
export function avgERByPostType(
  posts: AirtableRecord[],
): Array<{ type: string; avgER: number; count: number }> {
  return groupByDimension(
    posts,
    (p) => str(p.fields["Post Type"]) || "unknown",
    (p) => num(p.fields["Engagement Rate"]),
  ).map(({ label, avg, count }) => ({ type: label, avgER: avg, count }));
}

/** Aggregate posts by content theme, returning avg ER for each theme. */
export function avgERByTheme(
  posts: AirtableRecord[],
): Array<{ theme: string; avgER: number; count: number }> {
  return groupByDimension(
    posts,
    (p) => str(p.fields["Content Theme"]) || "untagged",
    (p) => num(p.fields["Engagement Rate"]),
  ).map(({ label, avg, count }) => ({ theme: label, avgER: avg, count }));
}

/**
 * Aggregate posts by (primary, segment) returning a stacked-bar-ready shape:
 * one row per primary category, with a per-segment breakdown of avg metric
 * value contribution and count. Used to render stacked bars where the height
 * of each segment is the avg of that segment's posts (not a share split).
 *
 * Returns rows sorted by the total of all segment values, primary segments
 * sorted by their global frequency so the legend is stable across rows.
 */
export function avgERByDimensionStacked(
  posts: AirtableRecord[],
  getPrimary: (p: AirtableRecord) => string,
  getSegment: (p: AirtableRecord) => string,
): {
  primaries: Array<{ label: string; total: number; count: number }>;
  segments: string[];
  /** primary -> segment -> { avg, count } - avg is reach-weighted ER (0-1). */
  matrix: Record<string, Record<string, { avg: number; count: number }>>;
} {
  // Each cell accumulates engagement + reach, so ER = sum(engagement) / sum(reach)
  // (reach-weighted), NOT a mean of per-post rates a single fluke post could
  // dominate. recordReach applies the Pinterest substitution; a post with no
  // reach still counts toward the cell's post count but not its rate.
  const cell = new Map<string, { eng: number; reach: number; count: number }>();
  const primaryTotals = new Map<string, { count: number }>();
  const segmentTotals = new Map<string, number>();

  for (const p of posts) {
    const primary = getPrimary(p) || "untagged";
    const segment = getSegment(p) || "untagged";
    const reach = recordReach(p);

    const key = `${primary} ${segment}`;
    const c = cell.get(key) ?? { eng: 0, reach: 0, count: 0 };
    c.count += 1;
    if (reach > 0) {
      c.eng += postEngagement(p);
      c.reach += reach;
    }
    cell.set(key, c);

    const pt = primaryTotals.get(primary) ?? { count: 0 };
    primaryTotals.set(primary, { count: pt.count + 1 });
    segmentTotals.set(segment, (segmentTotals.get(segment) ?? 0) + 1);
  }

  // Primaries sorted by post volume so the busiest themes lead (a rate sort
  // here would resurface the fluke-bucket problem at the row level).
  const primaries = Array.from(primaryTotals.entries())
    .map(([label, { count }]) => ({ label, total: count, count }))
    .sort((a, b) => b.count - a.count);

  const segments = Array.from(segmentTotals.entries())
    .sort((a, b) => b[1] - a[1])
    .map(([label]) => label);

  const matrix: Record<string, Record<string, { avg: number; count: number }>> = {};
  for (const { label: primary } of primaries) {
    matrix[primary] = {};
    for (const segment of segments) {
      const c = cell.get(`${primary} ${segment}`);
      matrix[primary][segment] = c
        ? { avg: c.reach > 0 ? c.eng / c.reach : 0, count: c.count }
        : { avg: 0, count: 0 };
    }
  }

  return { primaries, segments, matrix };
}

/**
 * Like avgERByDimensionStacked, but sums the metric per (primary, segment)
 * cell instead of averaging. Use for additive metrics (Engagement, Impressions,
 * Reach) where stacked bars are semantically valid — segments are contribution
 * to a total. Never use this with rates/ratios (ER, save rate) where stacking
 * would produce a meaningless sum.
 */
export function sumByDimensionStacked(
  posts: AirtableRecord[],
  getPrimary: (p: AirtableRecord) => string,
  getSegment: (p: AirtableRecord) => string,
  getMetric: (p: AirtableRecord) => number | undefined,
): {
  primaries: Array<{ label: string; total: number; count: number }>;
  segments: string[];
  /** primary -> segment -> { sum, count } */
  matrix: Record<string, Record<string, { sum: number; count: number }>>;
} {
  const cell = new Map<string, { sum: number; count: number }>();
  const primaryTotals = new Map<string, { total: number; count: number }>();
  const segmentTotals = new Map<string, number>();

  for (const p of posts) {
    const primary = getPrimary(p) || "untagged";
    const segment = getSegment(p) || "untagged";
    const metric = getMetric(p);
    if (metric === undefined) continue;

    const key = `${primary} ${segment}`;
    const c = cell.get(key) ?? { sum: 0, count: 0 };
    cell.set(key, { sum: c.sum + metric, count: c.count + 1 });

    const pt = primaryTotals.get(primary) ?? { total: 0, count: 0 };
    primaryTotals.set(primary, { total: pt.total + metric, count: pt.count + 1 });

    segmentTotals.set(segment, (segmentTotals.get(segment) ?? 0) + metric);
  }

  const primaries = Array.from(primaryTotals.entries())
    .map(([label, { total, count }]) => ({ label, total, count }))
    .sort((a, b) => b.total - a.total);

  // Sort segments by global metric total desc so highest-contribution segments
  // sit at the base of stacked bars (visually clearer than count-based ordering).
  const segments = Array.from(segmentTotals.entries())
    .sort((a, b) => b[1] - a[1])
    .map(([label]) => label);

  const matrix: Record<string, Record<string, { sum: number; count: number }>> = {};
  for (const { label: primary } of primaries) {
    matrix[primary] = {};
    for (const segment of segments) {
      const c = cell.get(`${primary} ${segment}`);
      matrix[primary][segment] = c
        ? { sum: c.sum, count: c.count }
        : { sum: 0, count: 0 };
    }
  }

  return { primaries, segments, matrix };
}

/** Group posts by day-of-week x hour for a heatmap. */
export function postingHeatmap(
  posts: AirtableRecord[],
): Array<{ day: number; hour: number; avgER: number; count: number }> {
  const grid = new Map<string, { totalER: number; count: number }>();

  for (const p of posts) {
    const dateStr = str(p.fields["Published At"]);
    if (!dateStr) continue;
    const d = new Date(dateStr);
    if (isNaN(d.getTime())) continue;
    const day = d.getUTCDay();
    const hour = d.getUTCHours();
    const key = `${day}-${hour}`;
    const er = num(p.fields["Engagement Rate"]);
    if (!grid.has(key)) grid.set(key, { totalER: 0, count: 0 });
    const g = grid.get(key)!;
    grid.set(key, { totalER: g.totalER + er, count: g.count + 1 });
  }

  return Array.from(grid.entries()).map(([key, { totalER, count }]) => {
    const [day, hour] = key.split("-").map(Number);
    return { day, hour, avgER: count > 0 ? totalER / count : 0, count };
  });
}

/** @deprecated Use groupByPlatform instead. */
export function splitByPlatform(metrics: AirtableRecord[]): {
  instagram: AirtableRecord[];
  facebook: AirtableRecord[];
} {
  const grouped = groupByPlatform(metrics);
  return {
    instagram: grouped.get("instagram") ?? [],
    facebook: grouped.get("facebook") ?? [],
  };
}

/** Group records by lowercase Platform field. */
export function groupByPlatform(
  records: AirtableRecord[],
): Map<string, AirtableRecord[]> {
  const groups = new Map<string, AirtableRecord[]>();

  for (const r of records) {
    const platform = str(r.fields["Platform"]).toLowerCase().trim();
    if (!platform) continue;
    const existing = groups.get(platform);
    if (existing) {
      existing.push(r);
    } else {
      groups.set(platform, [r]);
    }
  }

  return groups;
}

/** Sorted unique platform keys from records. */
export function getPlatformKeys(records: AirtableRecord[]): string[] {
  const keys = new Set<string>();
  for (const r of records) {
    const p = str(r.fields["Platform"]).toLowerCase().trim();
    if (p) keys.add(p);
  }
  return Array.from(keys).sort(
    (a, b) => platformSortOrder(a) - platformSortOrder(b),
  );
}

/** Get top N posts by a numeric field (descending).
 *
 * Optional `minImpressions` filter prevents tiny-sample noise (e.g. a pin with
 * 1 impression / 1 click reading as 100% ER) from dominating ranked lists.
 */
export function topPosts(
  posts: AirtableRecord[],
  field: string,
  n: number,
  opts: { minImpressions?: number } = {},
): AirtableRecord[] {
  const min = opts.minImpressions ?? 0;
  return [...posts]
    .filter((p) => num(p.fields["Impressions"]) >= min)
    .sort((a, b) => num(b.fields[field]) - num(a.fields[field]))
    .slice(0, n);
}

/** Sum a numeric field across records. */
export function sumField(records: AirtableRecord[], field: string): number {
  return records.reduce((acc, r) => acc + num(r.fields[field]), 0);
}

/**
 * Sum reach across records using `recordReach` per row, so Pinterest rows
 * (which report Impressions, not Reach) contribute their impressions instead
 * of a structural 0. Use this instead of sumField(records, "Reach") anywhere
 * a cross-platform reach total is shown.
 */
export function sumReach(records: AirtableRecord[]): number {
  return records.reduce((acc, r) => acc + recordReach(r), 0);
}

/** Average a numeric field across records. */
export function avgField(records: AirtableRecord[], field: string): number {
  if (records.length === 0) return 0;
  return sumField(records, field) / records.length;
}

/**
 * Platforms that actually report a daily metric in the current range (sum > 0).
 * Platforms whose pipeline writes 0/null for a metric they don't have (e.g. IG
 * account impressions, retired by Meta) contribute nothing to a cross-platform
 * sum, so they are excluded here and the KPI title names only the real sources.
 * A platform with a legitimate all-zero period is also excluded — its zeros
 * don't change the sum, so the title stays accurate either way.
 */
export function platformsReporting(
  platformKeys: string[],
  platformMap: Map<string, AirtableRecord[]>,
  field: string,
): string[] {
  return platformKeys.filter(
    (key) => sumField(platformMap.get(key) ?? [], field) > 0,
  );
}

/**
 * KPI title qualified with the platforms behind it: "Reach (Instagram)".
 * Returns the bare base title when every platform reports the metric (nothing
 * is excluded) or when none do (the card shows "—" anyway).
 */
export function qualifiedMetricTitle(
  base: string,
  reportingKeys: string[],
  allKeys: string[],
  label: (key: string) => string,
): string {
  if (reportingKeys.length === 0 || reportingKeys.length >= allKeys.length) {
    return base;
  }
  return `${base} (${reportingKeys.map(label).join(" + ")})`;
}

/**
 * Reach-weighted engagement rate across posts: total engagement ÷ total reach.
 * Engagement = likes + comments + saves + shares; reach uses recordReach (so
 * Pinterest's impressions substitute applies). Returns a fraction (0-1) to match
 * the stored per-post "Engagement Rate" scale; multiply by 100 for a percent.
 *
 * This is the statistically correct headline ER: a post that reached 5,000 at 2%
 * carries far more weight than one that reached 30 at 8%. Prefer this over
 * avgField(posts, "Engagement Rate"), which is an unweighted mean of per-post
 * ratios and lets tiny-reach posts dominate. Mirrors how save/comment rates are
 * already computed (sum ÷ reach) so all rate metrics are consistent.
 */
/**
 * Engagement of a single post — the platform-reported total.
 *
 * Reads the authoritative `Engagement` field, which each platform's refresher
 * populates with that platform's own engagement total:
 *  - Meta (IG/FB): likes + comments + saves + shares + REPOSTS. The component
 *    columns alone miss Reposts, so summing them under-counts.
 *  - Pinterest:    SAVE + PIN_CLICK. PIN_CLICK is NOT stored in any component
 *    column (only OUTBOUND_CLICK is, as "Link Clicks"), so summing components
 *    drops most Pinterest engagement and zeroes pins with only pin-clicks.
 *
 * Verified against live data 2026-06-04: `Engagement / reach` reproduces the
 * stored per-post `Engagement Rate` on every platform; the component sum does
 * not. So this field — not a component reconstruction — is the single source of
 * truth, and ER stays internally consistent when derived from it.
 *
 * Fallback: only when `Engagement` is genuinely absent (older rows predating the
 * field) do we fall back to the component sum. A blank `Engagement` in current
 * data always coincides with zero components (verified), so the fallback is a
 * no-op there and only helps legacy rows.
 */
export function postEngagement(r: AirtableRecord): number {
  const field = r.fields["Engagement"];
  if (field !== null && field !== undefined && field !== "") {
    return num(field);
  }
  return (
    num(r.fields["Likes"]) +
    num(r.fields["Comments"]) +
    num(r.fields["Saves"]) +
    num(r.fields["Shares"])
  );
}

export function weightedEngagementRate(records: AirtableRecord[]): number {
  const withReach = records.filter((r) => recordReach(r) > 0);
  if (withReach.length === 0) return 0;
  const engagement = withReach.reduce((s, r) => s + postEngagement(r), 0);
  const reach = withReach.reduce((s, r) => s + recordReach(r), 0);
  return reach > 0 ? engagement / reach : 0;
}

/**
 * Minimum posts a dimension bucket needs before it may be RANKED as a "best"
 * theme / time / hashtag. Buckets below this still display, but must not top a
 * ranking on the strength of one or two fluke posts. (rankable=false below it.)
 */
export const MIN_RANK_SAMPLE = 3;

/**
 * Reach-weighted engagement rate per dimension bucket: within each bucket,
 * total engagement ÷ total reach (recordReach, so Pinterest's impressions
 * substitute applies). Replaces the unweighted mean-of-per-post-rates that let
 * a single fluke post dominate a bucket and top a ranking.
 *
 * Returns buckets with: er (fraction 0-1), count, and rankable (count >=
 * MIN_RANK_SAMPLE). Sorted so rankable buckets lead, by er desc; sub-sample
 * buckets follow (still visible, never ranked #1). Use `rankable` to grey out
 * or annotate "best" callouts.
 */
export function weightedERByDimension(
  records: AirtableRecord[],
  getKey: (r: AirtableRecord) => string,
): Array<{ label: string; er: number; count: number; rankable: boolean }> {
  const groups = new Map<string, { eng: number; reach: number; count: number }>();
  for (const r of records) {
    const key = getKey(r) || "untagged";
    const reach = recordReach(r);
    const g = groups.get(key) ?? { eng: 0, reach: 0, count: 0 };
    // count every post in the bucket; only reach>0 posts contribute to the rate.
    g.count += 1;
    if (reach > 0) {
      g.eng += postEngagement(r);
      g.reach += reach;
    }
    groups.set(key, g);
  }
  return Array.from(groups.entries())
    .map(([label, { eng, reach, count }]) => ({
      label,
      er: reach > 0 ? eng / reach : 0,
      count,
      rankable: count >= MIN_RANK_SAMPLE,
    }))
    .sort((a, b) => {
      // Rankable buckets first, then by ER desc; sub-sample buckets after.
      if (a.rankable !== b.rankable) return a.rankable ? -1 : 1;
      return b.er - a.er;
    });
}

/**
 * Latest real Followers value from a platform's rows (sorted Date desc, so the
 * first non-empty cell is the most recent measurement). Returns null when no row
 * carries a value. Use this instead of records[0].fields["Followers"]: the newest
 * row can have an empty Followers cell (Meta partial-day), which would otherwise
 * read as 0 and produce a spurious follower count and a wild negative delta.
 */
export function latestFollowers(records: AirtableRecord[]): number | null {
  for (const r of records) {
    const v = r.fields["Followers"];
    if (v !== undefined && v !== null && v !== "") return num(v);
  }
  return null;
}

/**
 * Latest real IG account Views value (WEBDEV-367). Mirrors latestFollowers'
 * newest-row selection (records arrive Date desc, so the first real row is the
 * most recent) — it is NEVER summed across day-rows, because Meta exposes
 * Instagram Views only as a rolling 30-day account total on the newest row
 * (views_source='period_aggregate'), not a per-day series. Only rows with a real
 * Views source count; returns null when none do (renders as an em-dash — expected
 * while `views` is NULL upstream until the n8n change lands).
 */
export function latestViews(records: AirtableRecord[]): number | null {
  for (const r of records) {
    if (!hasRealViews(r)) continue;
    const v = r.fields["Views"];
    if (v !== undefined && v !== null && v !== "") return num(v);
  }
  return null;
}

/** Build unified date labels from multiple platform metric arrays, sorted ascending. */
export function buildUnifiedDates(
  ...metricArrays: AirtableRecord[][]
): string[] {
  const dateSet = new Set<string>();
  for (const arr of metricArrays) {
    for (const r of arr) {
      const d = str(r.fields["Date"]).split("T")[0];
      if (d) dateSet.add(d);
    }
  }
  return Array.from(dateSet).sort();
}

/** Calculate the comparison period (same duration, immediately before the selected range). */
export function getComparisonPeriod(
  startDate: string | null,
  endDate: string | null,
): { compStart: string; compEnd: string } | null {
  if (!startDate || !endDate) {
    // "All Time" — compare last 30 days vs 30 days before
    const now = new Date();
    const start = new Date(now);
    start.setUTCDate(start.getUTCDate() - 30);
    const compEnd = new Date(start);
    compEnd.setUTCDate(compEnd.getUTCDate() - 1);
    const compStart = new Date(compEnd);
    compStart.setUTCDate(compStart.getUTCDate() - 29);
    return {
      compStart: compStart.toISOString().split("T")[0],
      compEnd: compEnd.toISOString().split("T")[0],
    };
  }

  const s = new Date(startDate + "T00:00:00Z");
  const e = new Date(endDate + "T00:00:00Z");
  const durationMs = e.getTime() - s.getTime();
  const compEnd = new Date(s.getTime() - 86400000); // day before start
  const compStart = new Date(compEnd.getTime() - durationMs);

  return {
    compStart: compStart.toISOString().split("T")[0],
    compEnd: compEnd.toISOString().split("T")[0],
  };
}

/** Count hashtag frequency across posts. */
export function hashtagFrequency(
  posts: AirtableRecord[],
): Array<{ tag: string; count: number; avgER: number }> {
  const tagMap = new Map<string, { count: number; totalER: number }>();

  for (const p of posts) {
    const hashtags = str(p.fields["Hashtags"]);
    if (!hashtags) continue;
    const tags = hashtags
      .split(",")
      .map((t) => t.trim().toLowerCase())
      .filter((t) => t.length > 0);
    const er = num(p.fields["Engagement Rate"]);

    for (const tag of tags) {
      const existing = tagMap.get(tag) ?? { count: 0, totalER: 0 };
      tagMap.set(tag, {
        count: existing.count + 1,
        totalER: existing.totalER + er,
      });
    }
  }

  return Array.from(tagMap.entries())
    .map(([tag, { count, totalER }]) => ({
      tag,
      count,
      avgER: count > 0 ? totalER / count : 0,
    }))
    .sort((a, b) => b.count - a.count);
}

/**
 * Hashtags eligible for an AVERAGE-engagement-rate ranking, sorted by avg ER
 * descending. A hashtag's avg ER is only meaningful once it has been used
 * enough times — a tag used once has an "average" of a single post, which is
 * noise, not signal. Callers pass `minUses` (the sample-size floor) and should
 * surface each tag's `count` so the reader can see the n behind the bar.
 */
export function hashtagsForERRanking(
  posts: AirtableRecord[],
  minUses: number,
): Array<{ tag: string; count: number; avgER: number }> {
  return hashtagFrequency(posts)
    .filter((h) => h.count >= minUses)
    .sort((a, b) => b.avgER - a.avgER);
}

/**
 * Align metric values to a shared date array, filling gaps with a default.
 *
 * For LINE/TREND charts pass `defaultVal = null` so a missing day renders as a
 * gap (with Chart.js `spanGaps`) instead of a value of 0 — a 0 drags the line
 * to the floor and reads as a real crash to zero, which is misleading when the
 * platform simply had no record that day. For BAR/COUNT charts keep the default
 * 0, where "no posts that week" genuinely is 0.
 */
export function alignToDateArray<D extends number | null = number>(
  metrics: AirtableRecord[],
  dates: string[],
  field: string,
  defaultVal: D = 0 as D,
): (number | D)[] {
  const byDate = new Map<string, number>();
  for (const r of metrics) {
    const d = str(r.fields["Date"]).split("T")[0];
    if (d) byDate.set(d, num(r.fields[field]));
  }
  return dates.map((d) => byDate.get(d) ?? defaultVal);
}

/**
 * Like {@link alignToDateArray}, but missing/absent values become `null`
 * instead of 0 — so a trend chart with `spanGaps: false` renders an honest gap
 * rather than a dip to zero.
 *
 * The distinction matters now that the daily-facts model writes fields that are
 * honestly absent on some days (e.g. IG account Impressions has no per-day
 * value, so the cell is empty every day). Plotting those as 0 draws a false
 * flat-zero line; plotting them as null draws nothing, which is the truth.
 *
 * A value is a gap (`null`) when no record exists for the date OR the field is
 * empty/non-numeric on that record. A genuine measured 0 is preserved as 0 (a
 * real point), distinct from a gap. Negative values pass through (`num`), so
 * signed fields like Follower Delta are unaffected.
 */
export function alignToDateArrayNullable(
  metrics: AirtableRecord[],
  dates: string[],
  field: string,
): (number | null)[] {
  const byDate = new Map<string, number>();
  for (const r of metrics) {
    const d = str(r.fields["Date"]).split("T")[0];
    if (!d) continue;
    const raw = r.fields[field];
    // Empty / absent / non-numeric → leave as a gap (do not insert into map).
    if (raw === null || raw === undefined || raw === "") continue;
    if (typeof raw === "string" && !Number.isFinite(parseFloat(raw))) continue;
    byDate.set(d, num(raw));
  }
  return dates.map((d) => (byDate.has(d) ? byDate.get(d)! : null));
}
