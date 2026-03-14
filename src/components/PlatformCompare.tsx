"use client";

import { useMemo } from "react";
import { Bar, Line } from "react-chartjs-2";
import "@/lib/chartSetup";
import { defaultOptions } from "@/lib/chartSetup";
import { getPlatformConfig } from "@/lib/platforms";
import ChartCard from "./ChartCard";
import {
  num,
  str,
  formatNumber,
  formatPercent,
  avgField,
  sumField,
  groupByPlatform,
  getPlatformKeys,
  buildUnifiedDates,
  alignToDateArray,
} from "@/lib/utils";
import type { AirtableRecord } from "@/lib/utils";

interface PlatformCompareProps {
  posts: AirtableRecord[];
  dailyMetrics: AirtableRecord[];
}

interface PlatformKPIs {
  followers: number;
  avgER: number;
  totalReach: number;
  totalImpressions: number;
  posts: number;
  avgSaves: number;
  avgShares: number;
  profileViews: number;
  webClicks: number;
}

function PlatformCard({
  platformKey,
  kpis,
}: {
  platformKey: string;
  kpis: PlatformKPIs;
}) {
  const config = getPlatformConfig(platformKey);

  const rows = [
    { label: "Followers", value: formatNumber(kpis.followers) },
    { label: "Avg ER", value: formatPercent(kpis.avgER) },
    { label: "Total Reach", value: formatNumber(kpis.totalReach) },
    { label: "Posts", value: String(kpis.posts) },
    { label: "Profile Views", value: formatNumber(kpis.profileViews) },
    { label: "Web Clicks", value: formatNumber(kpis.webClicks) },
  ];

  return (
    <div
      className="rounded-xl p-5 space-y-3"
      style={{
        background: "var(--bg-card)",
        border: `1px solid ${config.color}4d`,
      }}
    >
      <h3 className="text-sm font-semibold" style={{ color: config.color }}>
        {config.label}
      </h3>
      <div className="grid grid-cols-3 gap-2">
        {rows.map((row) => (
          <div key={row.label}>
            <p
              className="text-[10px]"
              style={{ color: "var(--text-secondary)" }}
            >
              {row.label}
            </p>
            <p className="text-lg font-bold">{row.value}</p>
          </div>
        ))}
      </div>
    </div>
  );
}

export default function PlatformCompare({
  posts,
  dailyMetrics,
}: PlatformCompareProps) {
  const metricsMap = useMemo(
    () => groupByPlatform(dailyMetrics),
    [dailyMetrics],
  );
  const platformKeys = useMemo(
    () => getPlatformKeys(dailyMetrics),
    [dailyMetrics],
  );

  // Group posts by platform
  const postsMap = useMemo(() => groupByPlatform(posts), [posts]);

  // Per-platform KPIs
  const kpiMap = useMemo(() => {
    const result: Record<string, PlatformKPIs> = {};

    for (const key of platformKeys) {
      const metrics = metricsMap.get(key) ?? [];
      const platformPosts = postsMap.get(key) ?? [];
      const latest = metrics[0];

      result[key] = {
        followers: latest ? num(latest.fields["Followers"]) : 0,
        avgER: avgField(platformPosts, "Engagement Rate") * 100,
        totalReach: sumField(metrics, "Reach"),
        totalImpressions: sumField(metrics, "Impressions"),
        posts: platformPosts.length,
        avgSaves:
          platformPosts.length > 0
            ? sumField(platformPosts, "Saves") / platformPosts.length
            : 0,
        avgShares:
          platformPosts.length > 0
            ? sumField(platformPosts, "Shares") / platformPosts.length
            : 0,
        profileViews: sumField(metrics, "Profile Views"),
        webClicks: sumField(metrics, "Website Clicks"),
      };
    }

    return result;
  }, [platformKeys, metricsMap, postsMap]);

  // Bar comparison chart
  const comparisonData = useMemo(
    () => ({
      labels: ["Avg ER %", "Avg Saves/Post", "Avg Shares/Post"],
      datasets: platformKeys.map((key) => {
        const config = getPlatformConfig(key);
        const k = kpiMap[key];
        return {
          label: config.label,
          data: [k.avgER, k.avgSaves, k.avgShares],
          backgroundColor: config.color + "80",
          borderColor: config.color,
          borderWidth: 1,
        };
      }),
    }),
    [platformKeys, kpiMap],
  );

  // Unified date array
  const allDates = useMemo(
    () =>
      buildUnifiedDates(
        ...platformKeys.map((k) => metricsMap.get(k) ?? []),
      ),
    [platformKeys, metricsMap],
  );

  // ER trend comparison
  const erTrendData = useMemo(() => {
    const labels = allDates.map((d) => d.slice(5));

    return {
      labels,
      datasets: platformKeys.map((key) => {
        const config = getPlatformConfig(key);
        const metrics = metricsMap.get(key) ?? [];
        return {
          label: `${config.label} ER`,
          data: alignToDateArray(metrics, allDates, "Engagement Rate").map(
            (v) => v * 100,
          ),
          borderColor: config.color,
          tension: 0.3,
          pointRadius: 0,
        };
      }),
    };
  }, [platformKeys, metricsMap, allDates]);

  // Reach comparison
  const reachTrendData = useMemo(() => {
    const labels = allDates.map((d) => d.slice(5));

    return {
      labels,
      datasets: platformKeys.map((key) => {
        const config = getPlatformConfig(key);
        const metrics = metricsMap.get(key) ?? [];
        return {
          label: `${config.label} Reach`,
          data: alignToDateArray(metrics, allDates, "Reach"),
          borderColor: config.color,
          backgroundColor: config.colorFill,
          fill: true,
          tension: 0.3,
          pointRadius: 0,
        };
      }),
    };
  }, [platformKeys, metricsMap, allDates]);

  // Post type breakdown per platform
  const postTypeComparison = useMemo(() => {
    const typeMaps = new Map<string, Map<string, number>>();
    const allTypes = new Set<string>();

    for (const key of platformKeys) {
      const platformPosts = postsMap.get(key) ?? [];
      const typeMap = new Map<string, number>();
      for (const p of platformPosts) {
        const t = str(p.fields["Post Type"]) || "other";
        typeMap.set(t, (typeMap.get(t) ?? 0) + 1);
        allTypes.add(t);
      }
      typeMaps.set(key, typeMap);
    }

    const typeLabels = Array.from(allTypes);

    return {
      labels: typeLabels,
      datasets: platformKeys.map((key) => {
        const config = getPlatformConfig(key);
        const typeMap = typeMaps.get(key) ?? new Map();
        return {
          label: config.label,
          data: typeLabels.map((t) => typeMap.get(t) ?? 0),
          backgroundColor: config.color + "80",
        };
      }),
    };
  }, [platformKeys, postsMap]);

  if (dailyMetrics.length === 0 && posts.length === 0) {
    return (
      <div
        className="rounded-xl p-8 text-center"
        style={{
          background: "var(--bg-card)",
          border: "1px solid var(--border)",
        }}
      >
        <p className="text-sm" style={{ color: "var(--text-secondary)" }}>
          No platform data for this period. Try expanding the date range.
        </p>
      </div>
    );
  }

  // Dynamic grid for platform cards
  const cardGridCols =
    platformKeys.length <= 2
      ? "grid-cols-1 lg:grid-cols-2"
      : "grid-cols-1 sm:grid-cols-2 xl:grid-cols-3";

  return (
    <div className="space-y-6">
      {/* Platform KPI cards */}
      <div className={`grid ${cardGridCols} gap-4`}>
        {platformKeys.map((key) => (
          <PlatformCard key={key} platformKey={key} kpis={kpiMap[key]} />
        ))}
      </div>

      {/* Trend Charts */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <ChartCard title="Engagement Rate Comparison">
          <Line data={erTrendData} options={defaultOptions} />
        </ChartCard>
        <ChartCard title="Reach Comparison">
          <Line data={reachTrendData} options={defaultOptions} />
        </ChartCard>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <ChartCard title="Performance Comparison">
          <Bar data={comparisonData} options={defaultOptions} />
        </ChartCard>
        <ChartCard title="Content Mix by Platform">
          <Bar data={postTypeComparison} options={defaultOptions} />
        </ChartCard>
      </div>
    </div>
  );
}
