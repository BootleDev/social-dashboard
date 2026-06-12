"use client";

import { useMemo } from "react";
import { Line } from "react-chartjs-2";
import "@/lib/chartSetup";
import { useChartTheme } from "@/lib/useChartTheme";
import ChartCard from "./ChartCard";
import {
  followerTrendSeries,
  reachTrendSeries,
  engagementTrendSeries,
  trendCoverage,
  type TrendSeries,
} from "@/lib/trendSeries";
import type { AirtableRecord } from "@/lib/utils";

/**
 * TrendCharts — the multi-period trend block (WEBDEV-182 item 11).
 *
 * The Pulse north-star cards show the current window total + a single in-period
 * sparkline, but no period-over-period time-series. This block adds three
 * trend lines a leader was missing:
 *   - Followers over time   (account-grain, honest gaps)
 *   - Account reach over time (account-grain, honest gaps)
 *   - Post engagement over time (post-level volume, no-post days = real 0)
 *
 * The chart-shaping is delegated to the pure `trendSeries` builders, which are
 * unit-tested and shared with the parked OverviewDeepDive. This component is the
 * presentation layer only: theme colours, gap handling, and the honest
 * coverage caveat.
 *
 * Coverage note: account-fact history is short and not expected to be
 * backfilled, so when the measured window is thin the block says so rather than
 * drawing two points as a "trend".
 */

interface TrendChartsProps {
  /** Post records in the selected window (post-level engagement series). */
  posts: AirtableRecord[];
  /** Account Daily Facts in the selected window (followers + reach series). */
  dailyMetrics: AirtableRecord[];
}

/** Convert a pure TrendSeries into chart.js line-chart data with theme colours. */
function toLineData(series: TrendSeries, fill: boolean) {
  return {
    labels: series.labels,
    datasets: series.datasets.map((ds) => ({
      label: ds.label,
      data: ds.data,
      borderColor: ds.color,
      backgroundColor: fill ? ds.colorFill : ds.color,
      fill,
      tension: 0.3,
      pointRadius: 0,
      spanGaps: false,
    })),
  };
}

export default function TrendCharts({ posts, dailyMetrics }: TrendChartsProps) {
  const { lineChartOptions } = useChartTheme();

  const followerData = useMemo(
    () => toLineData(followerTrendSeries(dailyMetrics), false),
    [dailyMetrics],
  );
  const reachData = useMemo(
    () => toLineData(reachTrendSeries(dailyMetrics), false),
    [dailyMetrics],
  );
  const engagementData = useMemo(
    () => toLineData(engagementTrendSeries(posts), true),
    [posts],
  );
  const coverage = useMemo(() => trendCoverage(dailyMetrics), [dailyMetrics]);

  // Followers move on a tight band; let the axis fit the data instead of
  // anchoring at zero (otherwise the line looks flat).
  const followerOptions = useMemo(
    () => ({
      ...lineChartOptions,
      scales: {
        ...lineChartOptions.scales,
        y: { ...lineChartOptions.scales.y, beginAtZero: false },
      },
    }),
    [lineChartOptions],
  );

  const hasAccountSeries =
    followerData.datasets.length > 0 || reachData.datasets.length > 0;
  const hasEngagementSeries = engagementData.datasets.length > 0;

  if (!hasAccountSeries && !hasEngagementSeries) {
    return null;
  }

  const coverageNote = (() => {
    if (coverage.measuredDays === 0) {
      return "No account-level history measured yet — trend lines will fill in as daily facts accrue.";
    }
    const span =
      coverage.firstDate && coverage.lastDate
        ? ` (${coverage.firstDate} → ${coverage.lastDate})`
        : "";
    if (coverage.isThin) {
      return `Account-level history is still building — ${coverage.measuredDays} measured day${
        coverage.measuredDays === 1 ? "" : "s"
      } so far${span}. Read these as an early shape, not a settled trend; they lengthen as new days are recorded.`;
    }
    return `Account-level trend across ${coverage.measuredDays} measured days${span}. Gaps are days a platform did not report that metric, not zeros.`;
  })();

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between gap-2">
        <h3
          className="text-xs font-medium uppercase tracking-wide"
          style={{ color: "var(--text-secondary)" }}
        >
          Trends over time
        </h3>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {followerData.datasets.length > 0 && (
          <ChartCard
            title="Followers over time"
            height="220px"
            tooltip="Account-level follower count per platform over the measured days. A gap means the platform did not report a follower count that day (not a drop to zero)."
          >
            <Line data={followerData} options={followerOptions} />
          </ChartCard>
        )}
        {reachData.datasets.length > 0 && (
          <ChartCard
            title="Account reach over time"
            height="220px"
            tooltip="Account-level reach per platform over the measured days. Account reach is what each platform reports for the whole account — distinct from the post-level Total Reach above. A gap is an unreported day, not a zero."
          >
            <Line data={reachData} options={lineChartOptions} />
          </ChartCard>
        )}
      </div>

      {hasEngagementSeries && (
        <ChartCard
          title="Post engagement over time"
          height="220px"
          tooltip="Likes + comments + saves + shares summed across every post published that day, per platform. A day with no post is a genuine zero (nothing published), not a gap."
        >
          <Line data={engagementData} options={lineChartOptions} />
        </ChartCard>
      )}

      <p className="text-[11px]" style={{ color: "var(--text-secondary)" }}>
        {coverageNote}
      </p>
    </div>
  );
}
