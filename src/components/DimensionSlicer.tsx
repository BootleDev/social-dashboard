"use client";

import { useEffect, useMemo, useState } from "react";
import { Bar } from "react-chartjs-2";
import type { ChartEvent, ActiveElement } from "chart.js";
import "@/lib/chartSetup";
import { useChartTheme } from "@/lib/useChartTheme";
import ChartCard from "./ChartCard";
import StatsPanel from "./StatsPanel";
import PostDrilldownPanel from "./PostDrilldownPanel";
import { groupByDimension, timeBucket, dayOfWeek, str, num } from "@/lib/utils";
import { describe } from "@/lib/stats";
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

/** Minimum fill-rate (0-1) below which an option is considered unusable. */
const MIN_FILL_RATE = 0.05;

/**
 * For each option, compute the fraction of posts that produce a non-empty
 * value. Returns a parallel array of booleans (true = usable).
 */
function computeDimAvailability(
  posts: AirtableRecord[],
  options: typeof DIMENSION_OPTIONS,
): boolean[] {
  if (posts.length === 0) return options.map(() => false);
  return options.map((opt) => {
    let filled = 0;
    for (const r of posts) {
      const v = opt.getKey(r);
      if (v && v !== "untagged" && v !== "No") filled++;
    }
    return filled / posts.length >= MIN_FILL_RATE;
  });
}

function computeMetricAvailability(
  posts: AirtableRecord[],
  options: typeof METRIC_OPTIONS,
  normalizers: ReachNormalizers,
): boolean[] {
  if (posts.length === 0) return options.map(() => false);
  return options.map((opt) => {
    let filled = 0;
    for (const r of posts) {
      const v = opt.getMetric(r, normalizers);
      if (v !== undefined && Number.isFinite(v) && v !== 0) filled++;
    }
    return filled / posts.length >= MIN_FILL_RATE;
  });
}

export default function DimensionSlicer({ posts, normalizers }: DimensionSlicerProps) {
  const { colors, defaultOptions } = useChartTheme();
  const [dimIndex, setDimIndex] = useState(0);
  const [metricIndex, setMetricIndex] = useState(0);

  // Compute which dim/metric options have enough data to be useful for the
  // current post set. Empty options stay listed but are flagged in the UI so
  // the writer knows why a dim is unavailable instead of selecting and
  // getting a confusing blank chart.
  const dimAvailable = useMemo(
    () => computeDimAvailability(posts, DIMENSION_OPTIONS),
    [posts],
  );
  const metricAvailable = useMemo(
    () => computeMetricAvailability(posts, METRIC_OPTIONS, normalizers),
    [posts, normalizers],
  );

  // Auto-fall-back to a populated option if the current selection became empty
  // (e.g. due to platform filter change). Only runs when availability changes.
  useEffect(() => {
    if (!dimAvailable[dimIndex]) {
      const firstAvail = dimAvailable.findIndex(Boolean);
      if (firstAvail >= 0) setDimIndex(firstAvail);
    }
    if (!metricAvailable[metricIndex]) {
      const firstAvail = metricAvailable.findIndex(Boolean);
      if (firstAvail >= 0) setMetricIndex(firstAvail);
    }
  }, [dimAvailable, metricAvailable, dimIndex, metricIndex]);

  const dim = DIMENSION_OPTIONS[dimIndex];
  const metric = METRIC_OPTIONS[metricIndex];

  // Drilldown state: which bucket was clicked (full label without count suffix).
  const [drilldownBucket, setDrilldownBucket] = useState<string | null>(null);

  // Posts that belong to the clicked bucket. Re-computes only when the click
  // selection or input set changes — not on hover.
  const drilldownPosts = useMemo(() => {
    if (!drilldownBucket) return [];
    return posts.filter((r) => {
      const key = dim.getKey(r) || "untagged";
      return key === drilldownBucket;
    });
  }, [drilldownBucket, posts, dim]);

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
          backgroundColor: colors.series[0] + "80",
          borderColor: colors.series[0],
          borderWidth: 1,
        },
      ],
    };
  }, [posts, dim, metric, normalizers, colors]);

  // Bucket-label lookup (chart bar index → raw bucket key, since the chart
  // labels include the count suffix like "Question (49)").
  const bucketKeys = useMemo(() => {
    const grouped = groupByDimension(
      posts,
      dim.getKey,
      (r) => metric.getMetric(r, normalizers),
    ).filter((g) => g.label !== "untagged" && g.label !== "");
    return grouped.map((g) => g.label);
  }, [posts, dim, metric, normalizers]);

  // Per-group raw metric values. Used to detect outliers and surface the
  // "remove this one post and the average halves" callout. We deliberately
  // rebuild this here rather than refactoring groupByDimension to avoid
  // ripple changes across every other caller.
  const groupValues = useMemo(() => {
    const map = new Map<string, number[]>();
    for (const r of posts) {
      const key = dim.getKey(r) || "untagged";
      if (key === "untagged" || key === "") continue;
      const v = metric.getMetric(r, normalizers);
      if (v === undefined || !Number.isFinite(v)) continue;
      const arr = map.get(key) ?? [];
      arr.push(v);
      map.set(key, arr);
    }
    return map;
  }, [posts, dim, metric, normalizers]);

  // Stats across the full population of metric values (all groups). Powers
  // the Stats panel — quick read of distribution shape without the user
  // having to mentally aggregate the bars.
  const populationStats = useMemo(() => {
    const allValues: number[] = [];
    for (const arr of groupValues.values()) for (const v of arr) allValues.push(v);
    return describe(allValues);
  }, [groupValues]);

  const chartOptions = useMemo(
    () => ({
      ...defaultOptions,
      indexAxis: "y" as const,
      onClick: (_evt: ChartEvent, elements: ActiveElement[]) => {
        if (elements.length === 0) return;
        const idx = elements[0].index;
        const bucket = bucketKeys[idx];
        if (bucket) setDrilldownBucket(bucket);
      },
      onHover: (event: ChartEvent, elements: ActiveElement[]) => {
        const target = event.native?.target as HTMLElement | undefined;
        if (target) {
          target.style.cursor = elements.length > 0 ? "pointer" : "default";
        }
      },
      scales: {
        ...defaultOptions.scales,
        x: {
          ...defaultOptions.scales.x,
          title: { display: true, text: metric.yLabel, color: colors.axis },
        },
      },
    }),
    [metric, bucketKeys, defaultOptions, colors],
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
      tooltip="Pick any post attribute (Dimension) and any metric to see how each group performs. Bars are sorted by the metric, group sample size is in parentheses, click a bar to see the contributing posts."
      height="auto"
      headerAction={
        <StatsPanel
          stats={populationStats}
          format={(v) => metric.format(v)}
          context={`${metric.label} across all ${dim.label} groups`}
        />
      }
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
              <option key={d.label} value={i} disabled={!dimAvailable[i]}>
                {d.label}{!dimAvailable[i] ? " (no data)" : ""}
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
              <option key={m.label} value={i} disabled={!metricAvailable[i]}>
                {m.label}{!metricAvailable[i] ? " (no data)" : ""}
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
          className="flex items-center justify-center text-xs py-12"
          style={{ color: "var(--text-secondary)" }}
        >
          No tagged data for this dimension yet. Tag posts in the Tagging tab to
          unlock this chart.
        </div>
      ) : (
        <>
          {/* Bar chart needs an explicit height to render; row count drives it
              dynamically (16px per group, min 240px, max 600px) so dimensions
              with many buckets stay readable without overflowing. */}
          <div
            style={{
              height: `${Math.min(600, Math.max(240, chartData.labels.length * 28))}px`,
            }}
          >
            <Bar data={chartData} options={chartOptions} />
          </div>
          <p
            className="text-[10px] mt-2 text-right"
            style={{ color: "var(--text-secondary)" }}
          >
            Click a bar to see contributing posts
          </p>
        </>
      )}
      {drilldownBucket && (
        <PostDrilldownPanel
          posts={drilldownPosts}
          bucketLabel={`${dim.label}: ${drilldownBucket}`}
          metricLabel={metric.label}
          getMetricValue={(r) => metric.getMetric(r, normalizers)}
          formatMetric={metric.format}
          onClose={() => setDrilldownBucket(null)}
        />
      )}
    </ChartCard>
  );
}
