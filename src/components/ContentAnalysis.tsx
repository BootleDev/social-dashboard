"use client";

import { useMemo, useState } from "react";
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
  sumByDimensionStacked,
  sumField,
} from "@/lib/utils";
import type { AirtableRecord } from "@/lib/utils";

// CHART METRIC RULES
//   Additive metrics (Engagement, Impressions, Reach) -> stacked bars OK,
//     segments contribute to a meaningful total.
//   Rate metrics (Engagement Rate, Save Rate, Share Rate) -> grouped bars ONLY,
//     stacking would produce a nonsensical sum-of-rates.
type MetricKey = "engagement" | "engagementRate" | "impressions";

interface MetricConfig {
  label: string;
  /** Whether stacking the metric across segments is semantically meaningful. */
  additive: boolean;
  /** y-axis suffix in chart tooltips */
  formatter: (v: number) => string;
}

const METRICS: Record<MetricKey, MetricConfig> = {
  engagement: {
    label: "Total Engagement",
    additive: true,
    formatter: (v) => v.toLocaleString(),
  },
  impressions: {
    label: "Total Impressions",
    additive: true,
    formatter: (v) => v.toLocaleString(),
  },
  engagementRate: {
    label: "Avg Engagement Rate",
    additive: false,
    formatter: (v) => `${v.toFixed(2)}%`,
  },
};

function metricGetter(key: MetricKey): (p: AirtableRecord) => number {
  if (key === "engagement") {
    return (p) =>
      num(p.fields["Likes"]) +
      num(p.fields["Comments"]) +
      num(p.fields["Saves"]) +
      num(p.fields["Shares"]);
  }
  if (key === "impressions") return (p) => num(p.fields["Impressions"]);
  return (p) => num(p.fields["Engagement Rate"]);
}

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
  const [metricKey, setMetricKey] = useState<MetricKey>("engagement");
  const metric = METRICS[metricKey];

  // For ER (a rate), use avg aggregation. For additive metrics, use sum.
  // Then choose stacked vs grouped based on whether the metric is additive.
  const formatData = useMemo(() => {
    const getPrimary = (p: AirtableRecord) =>
      str(p.fields["Post Type"]) || "unknown";
    const getSegment = (p: AirtableRecord) =>
      str(p.fields["Content Theme"]) || "untagged";

    if (metric.additive) {
      const s = sumByDimensionStacked(posts, getPrimary, getSegment, metricGetter(metricKey));
      return {
        labels: s.primaries.map((p) => `${p.label} (${p.count})`),
        datasets: s.segments.map((segment, i) => ({
          label: segment,
          data: s.primaries.map((p) => s.matrix[p.label][segment].sum),
          backgroundColor: SEGMENT_COLORS[i % SEGMENT_COLORS.length] + "cc",
          borderWidth: 0,
        })),
      };
    }
    const a = avgERByDimensionStacked(posts, getPrimary, getSegment);
    return {
      labels: a.primaries.map((p) => `${p.label} (${p.count})`),
      datasets: a.segments.map((segment, i) => ({
        label: segment,
        data: a.primaries.map((p) => a.matrix[p.label][segment].avg * 100),
        backgroundColor: SEGMENT_COLORS[i % SEGMENT_COLORS.length] + "cc",
        borderWidth: 0,
      })),
    };
  }, [posts, metric.additive, metricKey]);

  const themeData = useMemo(() => {
    const getPrimary = (p: AirtableRecord) =>
      str(p.fields["Content Theme"]) || "untagged";
    const getSegment = (p: AirtableRecord) =>
      str(p.fields["Post Type"]) || "unknown";

    if (metric.additive) {
      const s = sumByDimensionStacked(posts, getPrimary, getSegment, metricGetter(metricKey));
      const top = s.primaries.slice(0, 10);
      return {
        labels: top.map((p) => `${p.label} (${p.count})`),
        datasets: s.segments.map((segment, i) => ({
          label: segment,
          data: top.map((p) => s.matrix[p.label][segment].sum),
          backgroundColor: SEGMENT_COLORS[i % SEGMENT_COLORS.length] + "cc",
          borderWidth: 0,
        })),
      };
    }
    const a = avgERByDimensionStacked(posts, getPrimary, getSegment);
    const top = a.primaries.slice(0, 10);
    return {
      labels: top.map((p) => `${p.label} (${p.count})`),
      datasets: a.segments.map((segment, i) => ({
        label: segment,
        data: top.map((p) => a.matrix[p.label][segment].avg * 100),
        backgroundColor: SEGMENT_COLORS[i % SEGMENT_COLORS.length] + "cc",
        borderWidth: 0,
      })),
    };
  }, [posts, metric.additive, metricKey]);

  // Stacked when additive (sums sum), grouped when a rate (sums don't sum).
  const chartOptions = useMemo(() => {
    const formatter = metric.formatter;
    return {
      ...defaultOptions,
      scales: {
        x: { ...defaultOptions.scales.x, stacked: metric.additive },
        y: {
          ...defaultOptions.scales.y,
          stacked: metric.additive,
          ticks: {
            ...defaultOptions.scales.y.ticks,
            callback: (v: string | number) => formatter(Number(v)),
          },
        },
      },
      plugins: {
        ...defaultOptions.plugins,
        tooltip: {
          ...defaultOptions.plugins.tooltip,
          callbacks: {
            label: (ctx: {
              dataset: { label?: string };
              parsed: { y: number | null; x: number | null };
            }) => {
              const v = ctx.parsed.y ?? ctx.parsed.x ?? 0;
              return `${ctx.dataset.label}: ${formatter(v)}`;
            },
          },
        },
      },
    };
  }, [metric.additive, metric.formatter]);

  const chartOptionsHorizontal = useMemo(
    () => {
      const formatter = metric.formatter;
      return {
        ...chartOptions,
        indexAxis: "y" as const,
        scales: {
          x: {
            ...defaultOptions.scales.x,
            stacked: metric.additive,
            ticks: {
              ...defaultOptions.scales.x.ticks,
              callback: (v: string | number) => formatter(Number(v)),
            },
          },
          y: { ...defaultOptions.scales.y, stacked: metric.additive },
        },
      };
    },
    [chartOptions, metric.additive, metric.formatter],
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

      <div className="flex items-center gap-2 text-xs">
        <span style={{ color: "var(--text-secondary)" }}>Metric:</span>
        {(Object.keys(METRICS) as MetricKey[]).map((k) => (
          <button
            key={k}
            onClick={() => setMetricKey(k)}
            className="px-2 py-1 rounded cursor-pointer transition-colors"
            style={{
              background:
                metricKey === k ? "var(--accent-purple)" : "var(--bg-secondary)",
              color: metricKey === k ? "#fff" : "var(--text-secondary)",
              border: "1px solid var(--border)",
            }}
          >
            {METRICS[k].label}
          </button>
        ))}
        <span className="opacity-50 ml-2">
          {metric.additive ? "stacked (additive)" : "grouped (rate)"}
        </span>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <ChartCard
          title={`${metric.label} by Post Type × Theme`}
          tooltip={
            metric.additive
              ? "Stacked: each segment is contribution to the format's total"
              : "Grouped: bars sit side-by-side. Rates don't sum."
          }
        >
          <Bar data={formatData} options={chartOptions} />
        </ChartCard>
        <ChartCard
          title={`Content Theme × Post Type`}
          tooltip={
            metric.additive
              ? "Stacked: each segment is contribution to the theme's total"
              : "Grouped: bars sit side-by-side. Rates don't sum."
          }
        >
          <Bar data={themeData} options={chartOptionsHorizontal} />
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
