"use client";

import { useMemo } from "react";
import { Bar, Scatter } from "react-chartjs-2";
import "@/lib/chartSetup";
import { CHART_COLORS, defaultOptions } from "@/lib/chartSetup";
import ChartCard from "./ChartCard";
import DimensionSlicer from "./DimensionSlicer";
import PostScorecardTable from "./PostScorecardTable";
import PostingHeatmap from "./PostingHeatmap";
import HashtagCharts from "./HashtagCharts";
import {
  num,
  avgERByPostType,
  avgERByTheme,
  groupByPlatform,
  getPlatformKeys,
} from "@/lib/utils";
import type { AirtableRecord } from "@/lib/utils";

interface ContentAnalysisProps {
  posts: AirtableRecord[];
  // Account-grain daily metrics — needed for the followers normalizer below.
  // "Followers" is an account-level field and does NOT exist on post records,
  // so it must come from here, not from summing posts (which yields 0 and
  // silently kills the Reach Score metric).
  dailyMetrics: AirtableRecord[];
}

export default function ContentAnalysis({
  posts,
  dailyMetrics,
}: ContentAnalysisProps) {
  const formatData = useMemo(() => {
    const breakdown = avgERByPostType(posts);
    return {
      labels: breakdown.map((b) => `${b.type} (${b.count})`),
      datasets: [
        {
          label: "Avg ER %",
          data: breakdown.map((b) => b.avgER * 100),
          backgroundColor: [
            CHART_COLORS.purple + "80",
            CHART_COLORS.blue + "80",
            CHART_COLORS.cyan + "80",
            CHART_COLORS.green + "80",
            CHART_COLORS.amber + "80",
            CHART_COLORS.pink + "80",
          ],
          borderWidth: 0,
        },
      ],
    };
  }, [posts]);

  const themeData = useMemo(() => {
    const breakdown = avgERByTheme(posts).slice(0, 10);
    return {
      labels: breakdown.map((b) => `${b.theme} (${b.count})`),
      datasets: [
        {
          label: "Avg ER %",
          data: breakdown.map((b) => b.avgER * 100),
          backgroundColor: CHART_COLORS.purple + "60",
          borderColor: CHART_COLORS.purple,
          borderWidth: 1,
        },
      ],
    };
  }, [posts]);

  const scatterData = useMemo(() => {
    return {
      datasets: [
        {
          label: "Posts",
          data: posts
            .filter((p) => num(p.fields["Reach"]) > 0)
            .map((p) => ({
              x:
                num(p.fields["Reach"]) > 0
                  ? (num(p.fields["Saves"]) / num(p.fields["Reach"])) * 100
                  : 0,
              y:
                num(p.fields["Reach"]) > 0
                  ? (num(p.fields["Shares"]) / num(p.fields["Reach"])) * 100
                  : 0,
            })),
          backgroundColor: CHART_COLORS.purple + "80",
          pointRadius: 5,
          pointHoverRadius: 7,
        },
      ],
    };
  }, [posts]);

  const normalizers = useMemo(() => {
    const maxVideoViews = posts.reduce(
      (max, p) => Math.max(max, num(p.fields["Video Views"])),
      0,
    );
    const maxImpressions = posts.reduce(
      (max, p) => Math.max(max, num(p.fields["Impressions"])),
      0,
    );
    // Account-grain followers: sum the latest Followers per platform from the
    // daily metrics, then average across reporting platforms — identical to the
    // Overview KPI (Overview.tsx). Falls back to 1 (a safe normalizer divisor)
    // when there's no account data, so reachScore degrades instead of dying.
    const platformMap = groupByPlatform(dailyMetrics);
    const platformKeys = getPlatformKeys(dailyMetrics);
    const totalFollowers = platformKeys.reduce((sum, key) => {
      const latest = (platformMap.get(key) ?? [])[0];
      return sum + (latest ? num(latest.fields["Followers"]) : 0);
    }, 0);
    const avgFollowers =
      totalFollowers > 0 && platformKeys.length > 0
        ? totalFollowers / platformKeys.length
        : 1;
    return { maxVideoViews, maxImpressions, avgFollowers };
  }, [posts, dailyMetrics]);

  const scatterOptions = {
    ...defaultOptions,
    scales: {
      ...defaultOptions.scales,
      x: {
        ...defaultOptions.scales.x,
        title: {
          display: true,
          text: "Save Rate %",
          color: CHART_COLORS.muted,
        },
      },
      y: {
        ...defaultOptions.scales.y,
        title: {
          display: true,
          text: "Share Rate %",
          color: CHART_COLORS.muted,
        },
      },
    },
  };

  if (posts.length === 0) {
    return (
      <div
        className="rounded-xl p-8 text-center"
        style={{
          background: "var(--bg-card)",
          border: "1px solid var(--border)",
        }}
      >
        <p className="text-sm" style={{ color: "var(--text-secondary)" }}>
          No posts found for this period. Try expanding the date range.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <PostScorecardTable posts={posts} />

      <DimensionSlicer posts={posts} normalizers={normalizers} />

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <ChartCard
          title="Avg Engagement Rate by Post Type"
          tooltip="Higher ER = better content-market fit for that format"
        >
          <Bar data={formatData} options={defaultOptions} />
        </ChartCard>
        <ChartCard
          title="Content Theme Performance"
          tooltip="Avg ER by AI-tagged content theme"
        >
          <Bar
            data={themeData}
            options={{ ...defaultOptions, indexAxis: "y" as const }}
          />
        </ChartCard>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <PostingHeatmap posts={posts} />
        <ChartCard
          title="Save Rate vs Share Rate"
          tooltip="Intent signals — saves = personal value, shares = social value"
        >
          <Scatter data={scatterData} options={scatterOptions} />
        </ChartCard>
      </div>

      <HashtagCharts posts={posts} />
    </div>
  );
}
