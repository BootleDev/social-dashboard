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
  str,
  avgERByDimensionStacked,
  sumField,
} from "@/lib/utils";
import type { AirtableRecord } from "@/lib/utils";

// Palette used to color stacked segments. Reused across both stacked charts
// so the same segment label gets the same color in the legend regardless of
// which chart it appears in.
const SEGMENT_COLORS = [
  CHART_COLORS.purple,
  CHART_COLORS.blue,
  CHART_COLORS.cyan,
  CHART_COLORS.green,
  CHART_COLORS.amber,
  CHART_COLORS.pink,
  CHART_COLORS.red,
];

interface ContentAnalysisProps {
  posts: AirtableRecord[];
  timezone?: string;
}

export default function ContentAnalysis({
  posts,
  timezone = "",
}: ContentAnalysisProps) {
  // Post Type bars, segmented (stacked) by Content Theme so we see which
  // themes drive ER within each format.
  const formatData = useMemo(() => {
    const stacked = avgERByDimensionStacked(
      posts,
      (p) => str(p.fields["Post Type"]) || "unknown",
      (p) => str(p.fields["Content Theme"]) || "untagged",
    );
    return {
      labels: stacked.primaries.map((p) => `${p.label} (${p.count})`),
      datasets: stacked.segments.map((segment, i) => ({
        label: segment,
        data: stacked.primaries.map(
          (p) => stacked.matrix[p.label][segment].avg * 100,
        ),
        backgroundColor: SEGMENT_COLORS[i % SEGMENT_COLORS.length] + "cc",
        borderWidth: 0,
      })),
    };
  }, [posts]);

  // Theme bars, segmented (stacked) by Post Type, capped to top 10 themes by total.
  const themeData = useMemo(() => {
    const stacked = avgERByDimensionStacked(
      posts,
      (p) => str(p.fields["Content Theme"]) || "untagged",
      (p) => str(p.fields["Post Type"]) || "unknown",
    );
    const topPrimaries = stacked.primaries.slice(0, 10);
    return {
      labels: topPrimaries.map((p) => `${p.label} (${p.count})`),
      datasets: stacked.segments.map((segment, i) => ({
        label: segment,
        data: topPrimaries.map(
          (p) => stacked.matrix[p.label][segment].avg * 100,
        ),
        backgroundColor: SEGMENT_COLORS[i % SEGMENT_COLORS.length] + "cc",
        borderWidth: 0,
      })),
    };
  }, [posts]);

  const stackedOptions = useMemo(
    () => ({
      ...defaultOptions,
      scales: {
        x: { ...defaultOptions.scales.x, stacked: true },
        y: { ...defaultOptions.scales.y, stacked: true },
      },
    }),
    [],
  );

  const stackedHorizontalOptions = useMemo(
    () => ({
      ...stackedOptions,
      indexAxis: "y" as const,
    }),
    [stackedOptions],
  );

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
    const avgFollowers =
      posts.length > 0 ? sumField(posts, "Followers") / posts.length : 1;
    return { maxVideoViews, maxImpressions, avgFollowers };
  }, [posts]);

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
      <PostScorecardTable posts={posts} timezone={timezone} />

      <DimensionSlicer posts={posts} normalizers={normalizers} />

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <ChartCard
          title="Engagement Rate by Post Type × Theme"
          tooltip="Stacked: each bar's segments show which themes drive ER within that format"
        >
          <Bar data={formatData} options={stackedOptions} />
        </ChartCard>
        <ChartCard
          title="Content Theme × Post Type"
          tooltip="Stacked: each theme's bar shows ER contribution by format"
        >
          <Bar data={themeData} options={stackedHorizontalOptions} />
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
