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
    const day = d.getDay();
    const hour = d.getHours();
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

/** Split daily metrics by platform. */
export function splitByPlatform(
  metrics: AirtableRecord[],
): { instagram: AirtableRecord[]; facebook: AirtableRecord[] } {
  const instagram: AirtableRecord[] = [];
  const facebook: AirtableRecord[] = [];

  for (const m of metrics) {
    const platform = str(m.fields["Platform"]).toLowerCase();
    if (platform === "instagram") instagram.push(m);
    else if (platform === "facebook") facebook.push(m);
  }

  return { instagram, facebook };
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
