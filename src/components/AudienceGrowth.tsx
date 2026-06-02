"use client";

import { useMemo } from "react";
import { Line, Bar } from "react-chartjs-2";
import "@/lib/chartSetup";
import { useChartTheme } from "@/lib/useChartTheme";
import { getPlatformConfig } from "@/lib/platforms";
import KPICard from "./KPICard";
import ChartCard from "./ChartCard";
import StatsPanel from "./StatsPanel";
import {
  num,
  formatNumber,
  groupByPlatform,
  getPlatformKeys,
  sumField,
  sumReach,
  buildUnifiedDates,
  alignToDateArray,
  alignToDateArrayNullable,
  trimTrailingZeroDay,
} from "@/lib/utils";
import { describe } from "@/lib/stats";
import type { AirtableRecord } from "@/lib/utils";

interface AudienceGrowthProps {
  posts: AirtableRecord[];
  dailyMetrics: AirtableRecord[];
}

export default function AudienceGrowth({
  posts,
  dailyMetrics,
}: AudienceGrowthProps) {
  const { colors, defaultOptions, lineChartOptions } = useChartTheme();

  const platformMap = useMemo(
    () => groupByPlatform(dailyMetrics),
    [dailyMetrics],
  );
  const platformKeys = useMemo(
    () => getPlatformKeys(dailyMetrics),
    [dailyMetrics],
  );

  // Unified date array — trim trailing day if no platform reported data yet
  // (Meta cron often hasn't filled today's values when we read).
  const allDates = useMemo(
    () => {
      const initial = buildUnifiedDates(
        ...platformKeys.map((k) => platformMap.get(k) ?? []),
      );
      // For each platform, align Followers to the initial array, then check
      // if every platform's trailing value is 0/null.
      const series = platformKeys.map((k) =>
        alignToDateArray(platformMap.get(k) ?? [], initial, "Followers"),
      );
      return trimTrailingZeroDay(initial, series);
    },
    [platformKeys, platformMap],
  );

  // Date before which IG follower values are known to be corrupted by the
  // upsert-stomp bug fixed 2026-05-26. Pre-this-date values cannot be
  // backfilled (Meta's API caps at 30 days), so we mask them with null so
  // chart.js skips them rather than rendering inflated numbers.
  const IG_CORRUPT_BEFORE = "2026-04-27";

  // Follower growth with daily change
  const followerGrowthData = useMemo(() => {
    const labels = allDates.map((d) => d.slice(5));

    const followerDatasets = platformKeys.map((key) => {
      const config = getPlatformConfig(key);
      const metrics = platformMap.get(key) ?? [];
      const raw = alignToDateArray(metrics, allDates, "Followers");
      // Mask IG corrupted historical values.
      const data =
        key === "instagram"
          ? raw.map((v, i) =>
              allDates[i] && allDates[i] < IG_CORRUPT_BEFORE ? null : v,
            )
          : raw;
      return {
        label: `${config.label} Followers`,
        data,
        borderColor: config.color,
        backgroundColor: config.colorFill,
        fill: false,
        tension: 0.3,
        pointRadius: 0,
        yAxisID: "y",
        spanGaps: false,
      };
    });

    // Daily gain from first platform that has data (secondary axis)
    const firstKey = platformKeys[0];
    const firstMetrics = firstKey ? (platformMap.get(firstKey) ?? []) : [];
    const rawGain = firstKey
      ? alignToDateArray(firstMetrics, allDates, "Followers Gained")
      : [];
    const maskedGain =
      firstKey === "instagram"
        ? rawGain.map((v, i) =>
            allDates[i] && allDates[i] < IG_CORRUPT_BEFORE ? null : v,
          )
        : rawGain;
    const gainDataset =
      firstKey && firstMetrics.length > 0
        ? [
            {
              label: `${getPlatformConfig(firstKey).label} Daily Gain`,
              data: maskedGain,
              borderColor: colors.series[3],
              backgroundColor: colors.series[3] + "20",
              fill: true,
              tension: 0.3,
              pointRadius: 0,
              yAxisID: "y1",
              borderDash: [4, 2],
            },
          ]
        : [];

    return {
      labels,
      datasets: [...followerDatasets, ...gainDataset],
    };
  }, [platformKeys, platformMap, allDates, colors]);

  const followerGrowthOptions = {
    ...lineChartOptions,
    scales: {
      ...lineChartOptions.scales,
      y: {
        ...lineChartOptions.scales.y,
        position: "left" as const,
        beginAtZero: false,
        title: { display: true, text: "Followers", color: colors.axis },
      },
      y1: {
        position: "right" as const,
        ticks: { color: colors.axis, font: { size: 10 } },
        grid: { drawOnChartArea: false },
        title: { display: true, text: "Daily Gain", color: colors.axis },
      },
    },
  };

  // Reach trend — dynamic per platform
  const reachData = useMemo(() => {
    const labels = allDates.map((d) => d.slice(5));

    return {
      labels,
      datasets: platformKeys.map((key) => {
        const config = getPlatformConfig(key);
        const metrics = platformMap.get(key) ?? [];
        return {
          label: `${config.label} Reach`,
          // Nullable: FB Reach is empty every day — gap, not a flat-zero line.
          data: alignToDateArrayNullable(metrics, allDates, key === "pinterest" ? "Impressions" : "Reach"),
          borderColor: config.color,
          tension: 0.3,
          pointRadius: 0,
          spanGaps: false,
        };
      }),
    };
  }, [platformKeys, platformMap, allDates]);

  // Profile views trend — dynamic per platform
  const profileViewsData = useMemo(() => {
    const labels = allDates.map((d) => d.slice(5));

    return {
      labels,
      datasets: platformKeys.map((key) => {
        const config = getPlatformConfig(key);
        const metrics = platformMap.get(key) ?? [];
        return {
          label: `${config.label} Profile Views`,
          // Nullable: IG has no honest per-day Profile Views (30d total only) —
          // omit the bar rather than draw a row of zero bars.
          data: alignToDateArrayNullable(metrics, allDates, "Profile Views"),
          backgroundColor: config.color + "60",
          borderColor: config.color,
          borderWidth: 1,
        };
      }),
    };
  }, [platformKeys, platformMap, allDates]);

  // Stats for the Stats panel on each chart. Lightweight — just the
  // distribution shapes a power user might want when validating a chart's
  // headline; no narrative.
  const followerGainStats = useMemo(() => {
    // Aggregate daily follower-gain values across all platforms, dropping
    // IG values from the corrupt era so they don't skew the distribution.
    const vals: number[] = [];
    for (const key of platformKeys) {
      const metrics = platformMap.get(key) ?? [];
      const series = alignToDateArray(metrics, allDates, "Followers Gained");
      series.forEach((v, i) => {
        if (key === "instagram" && allDates[i] && allDates[i] < IG_CORRUPT_BEFORE)
          return;
        if (v > 0) vals.push(v);
      });
    }
    return describe(vals);
  }, [platformKeys, platformMap, allDates]);

  const reachStats = useMemo(() => {
    const vals: number[] = [];
    for (const key of platformKeys) {
      const metrics = platformMap.get(key) ?? [];
      const series = alignToDateArray(metrics, allDates, key === "pinterest" ? "Impressions" : "Reach");
      for (const v of series) if (v > 0) vals.push(v);
    }
    return describe(vals);
  }, [platformKeys, platformMap, allDates]);

  const profileViewsStats = useMemo(() => {
    const vals: number[] = [];
    for (const key of platformKeys) {
      const metrics = platformMap.get(key) ?? [];
      const series = alignToDateArray(metrics, allDates, "Profile Views");
      for (const v of series) if (v > 0) vals.push(v);
    }
    return describe(vals);
  }, [platformKeys, platformMap, allDates]);

  // Per-platform KPIs
  const platformKPIs = useMemo(
    () =>
      platformKeys.map((key) => {
        const metrics = platformMap.get(key) ?? [];
        const latest = metrics[0];
        const followers = latest ? num(latest.fields["Followers"]) : 0;
        const growth = sumField(metrics, "Followers Gained");
        return { key, followers, growth };
      }),
    [platformKeys, platformMap],
  );

  const totalReach = sumReach(dailyMetrics);
  const totalWebClicks = sumField(dailyMetrics, "Website Clicks");
  // Website Clicks is no longer written by Meta Graph API v22.0 (closest field
  // bundles website + email + phone + address taps and isn't a substitute).
  // Detect "field never populated for this date range" so we can surface "—"
  // instead of a misleading 0. Real per-content website attribution is coming
  // from GA4 referrer data in a separate ticket.
  const hasWebsiteClickData = dailyMetrics.some((r) => {
    const v = r.fields["Website Clicks"];
    return v !== undefined && v !== null;
  });

  if (dailyMetrics.length === 0) {
    return (
      <div
        className="rounded-xl p-8 text-center"
        style={{
          background: "var(--bg-card)",
          border: "1px solid var(--border)",
        }}
      >
        <p className="text-sm" style={{ color: "var(--text-secondary)" }}>
          No audience data for this period. Try expanding the date range.
        </p>
      </div>
    );
  }

  // Dynamic grid: 2 cols minimum, scale up with platforms
  const gridCols =
    platformKPIs.length <= 2
      ? "grid-cols-2 sm:grid-cols-4"
      : "grid-cols-2 sm:grid-cols-3 lg:grid-cols-5";

  return (
    <div className="space-y-6">
      {/* KPI Row */}
      <div className={`grid ${gridCols} gap-3`}>
        {platformKPIs.map(({ key, followers, growth }) => {
          // MARKETING-19 Fix 5: Pinterest-specific caption explaining API limitations.
          // Per-pin reach is not exposed by Pinterest's API; impressions + saves
          // ARE available. Low absolute numbers at current 5-follower scale are
          // expected, not a tracking failure.
          const pinterestTip =
            key === "pinterest"
              ? "Pinterest's API doesn't expose per-pin reach (use Impressions instead). Low absolute numbers reflect current account scale (~5 followers), not a tracking gap."
              : undefined;
          return (
            <KPICard
              key={key}
              title={`${getPlatformConfig(key).label} Followers`}
              value={formatNumber(followers)}
              subtitle={`+${growth} in period`}
              platformLabel={key}
              tooltip={pinterestTip}
            />
          );
        })}
        <KPICard title="Total Reach" value={formatNumber(totalReach)} />
        <KPICard
          title="Website Clicks"
          value={hasWebsiteClickData ? formatNumber(totalWebClicks) : "—"}
          tooltip="Not tracked at the platform level in Meta Graph API v22.0. Real per-content website attribution is pending GA4 referrer integration (separate ticket)."
        />
      </div>

      {/* Follower Growth Chart */}
      <ChartCard
        title="Follower Growth (Daily)"
        height="350px"
        headerAction={
          <StatsPanel
            stats={followerGainStats}
            format={(v) => formatNumber(v)}
            context="Daily follower-gain distribution (excludes IG pre-2026-04-27 corrupted values)"
          />
        }
      >
        <Line data={followerGrowthData} options={followerGrowthOptions} />
      </ChartCard>
      <p
        className="text-[10px] -mt-2"
        style={{ color: "var(--text-secondary)" }}
      >
        Note: Instagram follower history before 2026-04-27 is hidden — those
        values were corrupted by an upsert bug and Meta&apos;s API only retains
        30 days of daily history, so they cannot be backfilled accurately.
        Daily values from 2026-04-27 onward are accurate.
      </p>

      {/* Reach + Profile Views */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <ChartCard
          title="Daily Reach by Platform"
          headerAction={
            <StatsPanel
              stats={reachStats}
              format={(v) => formatNumber(v)}
              context="Daily reach distribution across platforms"
            />
          }
        >
          <Line data={reachData} options={lineChartOptions} />
        </ChartCard>
        <ChartCard
          title="Profile / Page Views"
          headerAction={
            <StatsPanel
              stats={profileViewsStats}
              format={(v) => formatNumber(v)}
              context="Daily profile-view distribution across platforms"
            />
          }
        >
          <Bar data={profileViewsData} options={defaultOptions} />
        </ChartCard>
      </div>

      {/* Follows from Posts */}
      {sumField(posts, "Follows From Post") > 0 && (
        <div
          className="rounded-xl p-5"
          style={{
            background: "var(--bg-card)",
            border: "1px solid var(--border)",
          }}
        >
          <h3
            className="text-sm font-medium mb-2"
            style={{ color: "var(--text-secondary)" }}
          >
            Follower Sources from Posts
          </h3>
          <p className="text-2xl font-bold">
            {formatNumber(sumField(posts, "Follows From Post"))}
          </p>
          <p
            className="text-xs mt-1"
            style={{ color: "var(--text-secondary)" }}
          >
            Total new followers attributed to individual posts in this period
          </p>
        </div>
      )}
    </div>
  );
}
