/**
 * trendSeries — pure builders for the multi-period trend charts on the Pulse
 * tab (WEBDEV-182 item 11).
 *
 * These shape Account Daily Facts (account-grain reach/followers) and post
 * records (post-level engagement) into chart-ready `{ labels, datasets }`
 * structures. They hold no React and no chart.js theme/options, so they are
 * unit-tested directly and reused by both the new Pulse "Trends" panel
 * (TrendCharts) and the parked OverviewDeepDive component.
 *
 * Honesty rules carried over from the daily-facts model:
 *   - Account-grain series (followers, reach) use a NULLABLE alignment: a day
 *     with no measured value is a gap (null), never a dip to 0. A genuine
 *     measured 0 is preserved. With `spanGaps: false` the chart draws the gap.
 *   - Post-level engagement is a volume metric: a day with no post is a real 0
 *     (nothing was published/engaging), so it is summed to 0, not nulled.
 *
 * Note (2026-06-05): account-fact history is short and not expected to be
 * backfilled, so these series legitimately start sparse and lengthen forward as
 * new days accrue. `trendCoverage` lets the panel say so honestly rather than
 * implying a long dense history exists.
 */

import {
  str,
  groupByPlatform,
  getPlatformKeys,
  buildUnifiedDates,
  alignToDateArrayNullable,
  postEngagement,
} from "./utils";
import { getPlatformConfig, platformSortOrder } from "./platforms";
import type { AirtableRecord } from "./utils";

/** One platform's line on a trend chart. `null` entries are honest gaps. */
export interface TrendDataset {
  platform: string;
  label: string;
  color: string;
  colorFill: string;
  data: (number | null)[];
}

/** A chart-ready multi-platform trend series. */
export interface TrendSeries {
  /** X-axis labels, MM-DD, oldest-first. */
  labels: string[];
  datasets: TrendDataset[];
}

/** Strip the year for a compact axis label ("2026-05-01" → "05-01"). */
function axisLabel(date: string): string {
  return date.slice(5);
}

/**
 * Build a per-platform account-grain trend series for a numeric Account Daily
 * Facts field (e.g. "Followers", "Reach"), with honest gaps. Datasets are
 * sorted in canonical platform order.
 */
function accountFactSeries(
  facts: AirtableRecord[],
  field: string,
): TrendSeries {
  const platformMap = groupByPlatform(facts);
  const platformKeys = getPlatformKeys(facts);
  const dates = buildUnifiedDates(
    ...platformKeys.map((k) => platformMap.get(k) ?? []),
  );

  const datasets: TrendDataset[] = platformKeys.map((key) => {
    const config = getPlatformConfig(key);
    const rows = platformMap.get(key) ?? [];
    return {
      platform: key,
      label: config.label,
      color: config.color,
      colorFill: config.colorFill,
      data: alignToDateArrayNullable(rows, dates, field),
    };
  });

  return { labels: dates.map(axisLabel), datasets };
}

/** Per-platform follower trend over the measured account-fact days. */
export function followerTrendSeries(facts: AirtableRecord[]): TrendSeries {
  return accountFactSeries(facts, "Followers");
}

/** Per-platform account-grain reach trend over the measured account-fact days. */
export function reachTrendSeries(facts: AirtableRecord[]): TrendSeries {
  return accountFactSeries(facts, "Reach");
}

/**
 * Per-platform post-level engagement summed per day. Unlike the account-grain
 * series this fills no-post days with a genuine 0 (a volume metric: nothing
 * published that day means zero engagement, which is true, not a gap).
 */
export function engagementTrendSeries(posts: AirtableRecord[]): TrendSeries {
  // day -> platform -> summed engagement
  const byDay = new Map<string, Map<string, number>>();
  const platformsSeen = new Set<string>();

  for (const p of posts) {
    const day = str(p.fields["Published At"]).split("T")[0];
    if (!day) continue;
    const platform = str(p.fields["Platform"]).toLowerCase().trim();
    if (!platform) continue;
    platformsSeen.add(platform);

    const row = byDay.get(day) ?? new Map<string, number>();
    row.set(platform, (row.get(platform) ?? 0) + postEngagement(p));
    byDay.set(day, row);
  }

  const days = Array.from(byDay.keys()).sort((a, b) => a.localeCompare(b));
  const platforms = Array.from(platformsSeen).sort(
    (a, b) => platformSortOrder(a) - platformSortOrder(b),
  );

  const datasets: TrendDataset[] = platforms.map((key) => {
    const config = getPlatformConfig(key);
    return {
      platform: key,
      label: config.label,
      color: config.color,
      colorFill: config.colorFill,
      data: days.map((d) => byDay.get(d)?.get(key) ?? 0),
    };
  });

  return { labels: days.map(axisLabel), datasets };
}

/**
 * Below this many measured account-fact days, a trend line is too short to read
 * as a trend; the panel surfaces a "building history" caveat instead of
 * implying a long series.
 */
export const TREND_READABLE_DAY_FLOOR = 7;

export interface TrendCoverage {
  /** Distinct calendar days with at least one account-fact row. */
  measuredDays: number;
  /** Earliest / latest measured date (ISO yyyy-mm-dd), or null when empty. */
  firstDate: string | null;
  lastDate: string | null;
  /** True when the measured window is below the readable-trend floor. */
  isThin: boolean;
}

/**
 * Report how much measured history the account-fact trend series actually
 * spans, so the Pulse panel can be honest about a short or sparse window
 * rather than presenting two points as a "trend".
 */
export function trendCoverage(facts: AirtableRecord[]): TrendCoverage {
  const days = new Set<string>();
  for (const r of facts) {
    const d = str(r.fields["Date"]).split("T")[0];
    if (d) days.add(d);
  }
  const sorted = Array.from(days).sort((a, b) => a.localeCompare(b));
  return {
    measuredDays: sorted.length,
    firstDate: sorted[0] ?? null,
    lastDate: sorted[sorted.length - 1] ?? null,
    isThin: sorted.length < TREND_READABLE_DAY_FLOOR,
  };
}
