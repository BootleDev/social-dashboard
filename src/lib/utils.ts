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

/** Aggregate posts by post type, returning avg ER for each type. */
export function avgERByPostType(
  posts: AirtableRecord[],
): Array<{ type: string; avgER: number; count: number }> {
  const groups = new Map<string, { totalER: number; count: number }>();

  for (const p of posts) {
    const postType = str(p.fields["Post Type"]) || "unknown";
    const er = num(p.fields["Engagement Rate"]);
    if (!groups.has(postType)) groups.set(postType, { totalER: 0, count: 0 });
    const g = groups.get(postType)!;
    groups.set(postType, { totalER: g.totalER + er, count: g.count + 1 });
  }

  return Array.from(groups.entries())
    .map(([type, { totalER, count }]) => ({
      type,
      avgER: count > 0 ? totalER / count : 0,
      count,
    }))
    .sort((a, b) => b.avgER - a.avgER);
}

/** Aggregate posts by content theme, returning avg ER for each theme. */
export function avgERByTheme(
  posts: AirtableRecord[],
): Array<{ theme: string; avgER: number; count: number }> {
  const groups = new Map<string, { totalER: number; count: number }>();

  for (const p of posts) {
    const theme = str(p.fields["Content Theme"]) || "untagged";
    const er = num(p.fields["Engagement Rate"]);
    if (!groups.has(theme)) groups.set(theme, { totalER: 0, count: 0 });
    const g = groups.get(theme)!;
    groups.set(theme, { totalER: g.totalER + er, count: g.count + 1 });
  }

  return Array.from(groups.entries())
    .map(([theme, { totalER, count }]) => ({
      theme,
      avgER: count > 0 ? totalER / count : 0,
      count,
    }))
    .sort((a, b) => b.avgER - a.avgER);
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

/** Get top N posts by a numeric field (descending). */
export function topPosts(
  posts: AirtableRecord[],
  field: string,
  n: number,
): AirtableRecord[] {
  return [...posts]
    .sort((a, b) => num(b.fields[field]) - num(a.fields[field]))
    .slice(0, n);
}

/** Sum a numeric field across records. */
export function sumField(records: AirtableRecord[], field: string): number {
  return records.reduce((acc, r) => acc + num(r.fields[field]), 0);
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
