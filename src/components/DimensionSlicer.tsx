"use client";

import { useMemo, useState } from "react";
import { Bar } from "react-chartjs-2";
import "@/lib/chartSetup";
import { CHART_COLORS, defaultOptions } from "@/lib/chartSetup";
import ChartCard from "./ChartCard";
import { groupByDimension, timeBucket, dayOfWeek, str, num } from "@/lib/utils";
import {
  saveRate,
  commentRate,
  shareRate,
  repostRate,
  viewThroughRate,
  watchTimePct,
  engagementScore,
  reachScore,
  type ReachNormalizers,
} from "@/lib/derivedMetrics";
import { toPost } from "@/lib/types";
import type { AirtableRecord } from "@/lib/utils";

interface DimensionOption {
  label: string;
  getKey: (r: AirtableRecord) => string;
}

interface MetricOption {
  label: string;
  getMetric: (r: AirtableRecord, normalizers: ReachNormalizers) => number | undefined;
  format: (v: number) => string;
  yLabel: string;
}

const DIMENSION_OPTIONS: DimensionOption[] = [
  { label: "Post Type", getKey: (r) => str(r.fields["Post Type"]) },
  { label: "Content Pillar", getKey: (r) => str(r.fields["Content Pillar"]) },
  { label: "Hook Type", getKey: (r) => str(r.fields["Hook Type"]) },
  { label: "VO Type", getKey: (r) => str(r.fields["VO Type"]) },
  { label: "CTA Type", getKey: (r) => str(r.fields["CTA Type"]) },
  { label: "Visual Style", getKey: (r) => str(r.fields["Visual Style"]) },
  { label: "Setting", getKey: (r) => str(r.fields["Setting"]) },
  { label: "Content Theme", getKey: (r) => str(r.fields["Content Theme"]) },
  { label: "Time Bucket", getKey: (r) => timeBucket(str(r.fields["Published At"])) },
  { label: "Day of Week", getKey: (r) => dayOfWeek(str(r.fields["Published At"])) },
  {
    label: "On-Screen Text",
    getKey: (r) => (r.fields["On-Screen Text"] ? "Yes" : "No"),
  },
  {
    label: "Talent Present",
    getKey: (r) => (r.fields["Talent Present"] ? "Yes" : "No"),
  },
  {
    label: "Hook Present",
    getKey: (r) => (r.fields["Hook Present"] ? "Yes" : "No"),
  },
];

const METRIC_OPTIONS: MetricOption[] = [
  {
    label: "Engagement Rate",
    getMetric: (r) => num(r.fields["Engagement Rate"]) * 100,
    format: (v) => `${v.toFixed(2)}%`,
    yLabel: "ER %",
  },
  {
    label: "Save Rate",
    getMetric: (r) => {
      const p = toPost(r);
      const v = saveRate(p);
      return v !== undefined ? v * 100 : undefined;
    },
    format: (v) => `${v.toFixed(2)}%`,
    yLabel: "Save Rate %",
  },
  {
    label: "Share Rate",
    getMetric: (r) => {
      const p = toPost(r);
      const v = shareRate(p);
      return v !== undefined ? v * 100 : undefined;
    },
    format: (v) => `${v.toFixed(2)}%`,
    yLabel: "Share Rate %",
  },
  {
    label: "Comment Rate",
    getMetric: (r) => {
      const p = toPost(r);
      const v = commentRate(p);
      return v !== undefined ? v * 100 : undefined;
    },
    format: (v) => `${v.toFixed(2)}%`,
    yLabel: "Comment Rate %",
  },
  {
    label: "View-Through Rate",
    getMetric: (r) => {
      const p = toPost(r);
      const v = viewThroughRate(p);
      return v !== undefined ? v * 100 : undefined;
    },
    format: (v) => `${v.toFixed(1)}%`,
    yLabel: "VTR %",
  },
  {
    label: "Watch Time %",
    getMetric: (r) => {
      const p = toPost(r);
      const v = watchTimePct(p);
      return v !== undefined ? v * 100 : undefined;
    },
    format: (v) => `${v.toFixed(1)}%`,
    yLabel: "Watch Time %",
  },
  {
    label: "Reach",
    getMetric: (r) => num(r.fields["Reach"]),
    format: (v) => v.toFixed(0),
    yLabel: "Avg Reach",
  },
  {
    label: "Engagement Score",
    getMetric: (r) => {
      const p = toPost(r);
      return engagementScore(p);
    },
    format: (v) => v.toFixed(1),
    yLabel: "Engagement Score (0–100)",
  },
  {
    label: "Reach Score",
    getMetric: (r, normalizers) => {
      const p = toPost(r);
      return reachScore(p, normalizers);
    },
    format: (v) => v.toFixed(1),
    yLabel: "Reach Score (0–100)",
  },
  // Added 2026-05-26: outcome variables from the new IG Reels signals + Pinterest.
  // Skip Rate is IG Reels only; Repost Rate is IG only; Outbound Click is
  // primarily Pinterest. Empty buckets are filtered by the chart at render time.
  {
    label: "Skip Rate (Reels)",
    getMetric: (r) => {
      const v = num(r.fields["Skip Rate"]);
      // 0 means "no data" not "perfect retention" — return undefined so the
      // bucket gets excluded from the average rather than dragging it to 0.
      return v > 0 ? v : undefined;
    },
    format: (v) => `${v.toFixed(1)}%`,
    yLabel: "Skip Rate %",
  },
  {
    label: "Repost Rate",
    getMetric: (r) => {
      const p = toPost(r);
      const v = repostRate(p);
      return v !== undefined ? v * 100 : undefined;
    },
    format: (v) => `${v.toFixed(2)}%`,
    yLabel: "Repost Rate %",
  },
  {
    label: "Reposts (total)",
    getMetric: (r) => num(r.fields["Reposts"]),
    format: (v) => v.toFixed(1),
    yLabel: "Avg Reposts",
  },
  {
    label: "Outbound Clicks (Pinterest)",
    getMetric: (r) => {
      // Pinterest pin records store outbound clicks in Link Clicks (per the
      // Pinterest Data Refresher's posts.push mapping).
      const platform = str(r.fields["Platform"]).toLowerCase();
      if (platform !== "pinterest") return undefined;
      return num(r.fields["Link Clicks"]);
    },
    format: (v) => v.toFixed(1),
    yLabel: "Avg Outbound Clicks",
  },
];

interface DimensionSlicerProps {
  posts: AirtableRecord[];
  normalizers: ReachNormalizers;
}

export default function DimensionSlicer({ posts, normalizers }: DimensionSlicerProps) {
  const [dimIndex, setDimIndex] = useState(0);
  const [metricIndex, setMetricIndex] = useState(0);

  const dim = DIMENSION_OPTIONS[dimIndex];
  const metric = METRIC_OPTIONS[metricIndex];

  const chartData = useMemo(() => {
    const grouped = groupByDimension(
      posts,
      dim.getKey,
      (r) => metric.getMetric(r, normalizers),
    ).filter((g) => g.label !== "untagged" && g.label !== "");

    return {
      labels: grouped.map((g) => `${g.label} (${g.count})`),
      datasets: [
        {
          label: metric.label,
          data: grouped.map((g) => g.avg),
          backgroundColor: CHART_COLORS.purple + "80",
          borderColor: CHART_COLORS.purple,
          borderWidth: 1,
        },
      ],
    };
  }, [posts, dim, metric, normalizers]);

  const chartOptions = useMemo(
    () => ({
      ...defaultOptions,
      indexAxis: "y" as const,
      scales: {
        ...defaultOptions.scales,
        x: {
          ...defaultOptions.scales.x,
          title: { display: true, text: metric.yLabel, color: CHART_COLORS.muted },
        },
      },
    }),
    [metric],
  );

  const selectClass =
    "text-xs rounded px-2 py-1 border cursor-pointer outline-none";
  const selectStyle = {
    background: "var(--bg-secondary)",
    color: "var(--text-primary)",
    borderColor: "var(--border)",
  };

  return (
    <ChartCard
      title="Dimension Slicer"
      tooltip="Average metric per dimension value across filtered posts"
      height="340px"
    >
      <div className="flex items-center gap-3 mb-4">
        <div className="flex items-center gap-1.5">
          <label className="text-xs" style={{ color: "var(--text-secondary)" }}>
            Dimension
          </label>
          <select
            className={selectClass}
            style={selectStyle}
            value={dimIndex}
            onChange={(e) => setDimIndex(Number(e.target.value))}
            aria-label="Select dimension"
          >
            {DIMENSION_OPTIONS.map((d, i) => (
              <option key={d.label} value={i}>
                {d.label}
              </option>
            ))}
          </select>
        </div>
        <div className="flex items-center gap-1.5">
          <label className="text-xs" style={{ color: "var(--text-secondary)" }}>
            Metric
          </label>
          <select
            className={selectClass}
            style={selectStyle}
            value={metricIndex}
            onChange={(e) => setMetricIndex(Number(e.target.value))}
            aria-label="Select metric"
          >
            {METRIC_OPTIONS.map((m, i) => (
              <option key={m.label} value={i}>
                {m.label}
              </option>
            ))}
          </select>
        </div>
        {posts.length > 0 && (
          <span className="text-xs ml-auto" style={{ color: "var(--text-secondary)" }}>
            {posts.length} posts
          </span>
        )}
      </div>
      {chartData.labels.length === 0 ? (
        <div
          className="flex items-center justify-center h-full text-xs"
          style={{ color: "var(--text-secondary)" }}
        >
          No tagged data for this dimension yet. Tag posts in the Tagging tab to
          unlock this chart.
        </div>
      ) : (
        <Bar data={chartData} options={chartOptions} />
      )}
    </ChartCard>
  );
}
