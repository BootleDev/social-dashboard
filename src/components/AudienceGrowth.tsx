"use client";

import { useMemo } from "react";
import { Line, Bar } from "react-chartjs-2";
import "@/lib/chartSetup";
import { CHART_COLORS, defaultOptions } from "@/lib/chartSetup";
import { getPlatformConfig } from "@/lib/platforms";
import KPICard from "./KPICard";
import ChartCard from "./ChartCard";
import {
  num,
  formatNumber,
  groupByPlatform,
  getPlatformKeys,
  sumField,
  buildUnifiedDates,
  alignToDateArray,
} from "@/lib/utils";
import type { AirtableRecord } from "@/lib/utils";

interface AudienceGrowthProps {
  posts: AirtableRecord[];
  dailyMetrics: AirtableRecord[];
}

export default function AudienceGrowth({
  posts,
  dailyMetrics,
}: AudienceGrowthProps) {
  const platformMap = useMemo(
    () => groupByPlatform(dailyMetrics),
    [dailyMetrics],
  );
  const platformKeys = useMemo(
    () => getPlatformKeys(dailyMetrics),
    [dailyMetrics],
  );

  // Unified date array
  const allDates = useMemo(
    () =>
      buildUnifiedDates(
        ...platformKeys.map((k) => platformMap.get(k) ?? []),
      ),
    [platformKeys, platformMap],
  );

  // Follower growth with daily change
  const followerGrowthData = useMemo(() => {
    const labels = allDates.map((d) => d.slice(5));

    const followerDatasets = platformKeys.map((key) => {
      const config = getPlatformConfig(key);
      const metrics = platformMap.get(key) ?? [];
      return {
        label: `${config.label} Followers`,
        data: alignToDateArray(metrics, allDates, "Followers"),
        borderColor: config.color,
        backgroundColor: config.colorFill,
        fill: true,
        tension: 0.3,
        pointRadius: 0,
        yAxisID: "y",
      };
    });

    // Daily gain from first platform that has data (secondary axis)
    const firstKey = platformKeys[0];
    const firstMetrics = firstKey ? (platformMap.get(firstKey) ?? []) : [];
    const gainDataset =
      firstKey && firstMetrics.length > 0
        ? [
            {
              label: `${getPlatformConfig(firstKey).label} Daily Gain`,
              data: alignToDateArray(
                firstMetrics,
                allDates,
                "Followers Gained",
              ),
              borderColor: CHART_COLORS.green,
              backgroundColor: CHART_COLORS.green + "20",
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
  }, [platformKeys, platformMap, allDates]);

  const followerGrowthOptions = {
    ...defaultOptions,
    scales: {
      ...defaultOptions.scales,
      y: {
        ...defaultOptions.scales.y,
        position: "left" as const,
        title: { display: true, text: "Followers", color: CHART_COLORS.muted },
      },
      y1: {
        position: "right" as const,
        ticks: { color: CHART_COLORS.muted, font: { size: 10 } },
        grid: { drawOnChartArea: false },
        title: { display: true, text: "Daily Gain", color: CHART_COLORS.muted },
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
          data: alignToDateArray(metrics, allDates, "Reach"),
          borderColor: config.color,
          tension: 0.3,
          pointRadius: 0,
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
          data: alignToDateArray(metrics, allDates, "Profile Views"),
          backgroundColor: config.color + "60",
          borderColor: config.color,
          borderWidth: 1,
        };
      }),
    };
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

  const totalReach = sumField(dailyMetrics, "Reach");
  const totalWebClicks = sumField(dailyMetrics, "Website Clicks");

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
        {platformKPIs.map(({ key, followers, growth }) => (
          <KPICard
            key={key}
            title={`${getPlatformConfig(key).label} Followers`}
            value={formatNumber(followers)}
            subtitle={`+${growth} in period`}
            platformLabel={key}
          />
        ))}
        <KPICard title="Total Reach" value={formatNumber(totalReach)} />
        <KPICard
          title="Website Clicks"
          value={formatNumber(totalWebClicks)}
          tooltip="Bio link and post link clicks"
        />
      </div>

      {/* Follower Growth Chart */}
      <ChartCard title="Follower Growth (Daily)" height="350px">
        <Line data={followerGrowthData} options={followerGrowthOptions} />
      </ChartCard>

      {/* Reach + Profile Views */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <ChartCard title="Daily Reach by Platform">
          <Line data={reachData} options={defaultOptions} />
        </ChartCard>
        <ChartCard title="Profile / Page Views">
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
