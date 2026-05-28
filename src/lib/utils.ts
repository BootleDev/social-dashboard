import { platformSortOrder } from "./platforms";

export type Fields = Record<string, unknown>;

export type AirtableRecord = {
  id: string;
  fields: Fields;
  createdTime: string;
};

export function num(val: unknown): number {
  if (typeof val === "number") return val;
  if (typeof val === "string") return parseFloat(val) || 0;
  return 0;
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
    const impressions = num(record.fields["Impressions"]);
    return impressions > 0 ? impressions : num(record.fields["Reach"]);
  }
  return num(record.fields["Reach"]);
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
  getMetric: (p: AirtableRecord) => number | undefined = (p) =>
    num(p.fields["Engagement Rate"]),
): {
  primaries: Array<{ label: string; total: number; count: number }>;
  segments: string[];
  /** primary -> segment -> { avg, count } */
  matrix: Record<string, Record<string, { avg: number; count: number }>>;
} {
  const cell = new Map<string, { total: number; count: number }>();
  const primaryTotals = new Map<string, { total: number; count: number }>();
  const segmentTotals = new Map<string, number>();

  for (const p of posts) {
    const primary = getPrimary(p) || "untagged";
    const segment = getSegment(p) || "untagged";
    const metric = getMetric(p);
    if (metric === undefined) continue;

    const key = `${primary} ${segment}`;
    const c = cell.get(key) ?? { total: 0, count: 0 };
    cell.set(key, { total: c.total + metric, count: c.count + 1 });

    const pt = primaryTotals.get(primary) ?? { total: 0, count: 0 };
    primaryTotals.set(primary, { total: pt.total + metric, count: pt.count + 1 });

    segmentTotals.set(segment, (segmentTotals.get(segment) ?? 0) + 1);
  }

  const primaries = Array.from(primaryTotals.entries())
    .map(([label, { total, count }]) => ({ label, total, count }))
    .sort((a, b) => b.total - a.total);

  const segments = Array.from(segmentTotals.entries())
    .sort((a, b) => b[1] - a[1])
    .map(([label]) => label);

  const matrix: Record<string, Record<string, { avg: number; count: number }>> = {};
  for (const { label: primary } of primaries) {
    matrix[primary] = {};
    for (const segment of segments) {
      const c = cell.get(`${primary} ${segment}`);
      matrix[primary][segment] = c
        ? { avg: c.count > 0 ? c.total / c.count : 0, count: c.count }
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

/** Align metric values to a shared date array, filling gaps with a default. */
export function alignToDateArray(
  metrics: AirtableRecord[],
  dates: string[],
  field: string,
  defaultVal = 0,
): number[] {
  const byDate = new Map<string, number>();
  for (const r of metrics) {
    const d = str(r.fields["Date"]).split("T")[0];
    if (d) byDate.set(d, num(r.fields[field]));
  }
  return dates.map((d) => byDate.get(d) ?? defaultVal);
}
