"use client";

import { useEffect, useMemo, useState } from "react";
import { Bar } from "react-chartjs-2";
import type { ChartEvent, ActiveElement } from "chart.js";
import "@/lib/chartSetup";
import { useChartTheme } from "@/lib/useChartTheme";
import ChartCard from "./ChartCard";
import StatsPanel from "./StatsPanel";
import PostDrilldownPanel from "./PostDrilldownPanel";
import {
  groupByDimension,
  timeBucket,
  dayOfWeek,
  str,
  num,
  recordReach,
  postEngagement,
  MIN_RANK_SAMPLE,
} from "@/lib/utils";
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
  effectiveReach,
} from "@/lib/derivedMetrics";
import { toPost } from "@/lib/types";
import type { AirtableRecord } from "@/lib/utils";
import { glossaryFor } from "@/lib/metricGlossary";
import InfoTooltip from "./InfoTooltip";

interface DimensionOption {
  label: string;
  getKey: (r: AirtableRecord) => string;
}

// How a metric aggregates over a bucket of posts:
//  "weighted-rate" — Σnumerator ÷ Σreach (reach-weighted, the correct way to
//      aggregate a ratio; a tiny-reach post can't swing the bucket).
//  "mean" — simple mean per post (for absolute volumes like Reach, Reposts).
//  "score-mean" — mean of per-post composite scores (0-100 scores are designed
//      to be averaged, not reach-weighted).
type MetricKind = "weighted-rate" | "mean" | "score-mean";

interface MetricOption {
  label: string;
  kind: MetricKind;
  /** Per-post value for the chart-less paths (availability, drilldown, outliers). */
  getMetric: (r: AirtableRecord) => number | undefined;
  /** For weighted-rate metrics: the numerator summed over the bucket (× reach denom). */
  numerator?: (r: AirtableRecord) => number;
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
    kind: "weighted-rate",
    getMetric: (r) => num(r.fields["Engagement Rate"]) * 100,
    numerator: (r) => postEngagement(r),
    format: (v) => `${v.toFixed(2)}%`,
    yLabel: "ER %",
  },
  {
    label: "Save Rate",
    kind: "weighted-rate",
    getMetric: (r) => {
      const p = toPost(r);
      const v = saveRate(p);
      return v !== undefined ? v * 100 : undefined;
    },
    numerator: (r) => num(r.fields["Saves"]),
    format: (v) => `${v.toFixed(2)}%`,
    yLabel: "Save Rate %",
  },
  {
    label: "Share Rate",
    kind: "weighted-rate",
    getMetric: (r) => {
      const p = toPost(r);
      const v = shareRate(p);
      return v !== undefined ? v * 100 : undefined;
    },
    numerator: (r) => num(r.fields["Shares"]),
    format: (v) => `${v.toFixed(2)}%`,
    yLabel: "Share Rate %",
  },
  {
    label: "Comment Rate",
    kind: "weighted-rate",
    getMetric: (r) => {
      const p = toPost(r);
      const v = commentRate(p);
      return v !== undefined ? v * 100 : undefined;
    },
    numerator: (r) => num(r.fields["Comments"]),
    format: (v) => `${v.toFixed(2)}%`,
    yLabel: "Comment Rate %",
  },
  {
    label: "View-Through Rate",
    kind: "weighted-rate",
    getMetric: (r) => {
      const p = toPost(r);
      const v = viewThroughRate(p);
      return v !== undefined ? v * 100 : undefined;
    },
    numerator: (r) => num(r.fields["Video Views"]),
    format: (v) => `${v.toFixed(1)}%`,
    yLabel: "VTR %",
  },
  {
    label: "Watch Time %",
    kind: "score-mean",
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
    kind: "mean",
    getMetric: (r) => num(r.fields["Reach"]),
    format: (v) => v.toFixed(0),
    yLabel: "Avg Reach",
  },
  {
    label: "Engagement Score",
    kind: "score-mean",
    getMetric: (r) => {
      const p = toPost(r);
      return engagementScore(p);
    },
    format: (v) => v.toFixed(1),
    yLabel: "Engagement Score (0–100)",
  },
  {
    label: "Reach Score",
    kind: "score-mean",
    getMetric: (r) => {
      const p = toPost(r);
      return reachScore(p);
    },
    format: (v) => v.toFixed(1),
    yLabel: "Reach Score (0–100)",
  },
  // Added 2026-05-26: outcome variables from the new IG Reels signals + Pinterest.
  // Skip Rate is IG Reels only; Repost Rate is IG only; Outbound Click is
  // primarily Pinterest. Empty buckets are filtered by the chart at render time.
  {
    label: "Skip Rate (Reels)",
    // Stored as a per-post % with no clean reach denominator to re-weight by;
    // average the per-post values (excluding 0 = no data).
    kind: "score-mean",
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
    kind: "weighted-rate",
    getMetric: (r) => {
      const p = toPost(r);
      const v = repostRate(p);
      return v !== undefined ? v * 100 : undefined;
    },
    numerator: (r) => num(r.fields["Reposts"]),
    format: (v) => `${v.toFixed(2)}%`,
    yLabel: "Repost Rate %",
  },
  {
    label: "Reposts (total)",
    kind: "mean",
    getMetric: (r) => num(r.fields["Reposts"]),
    format: (v) => v.toFixed(1),
    yLabel: "Avg Reposts",
  },
  {
    label: "Outbound Clicks (Pinterest)",
    kind: "mean",
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
}

interface DimBucket {
  label: string;
  value: number;
  count: number;
  rankable: boolean;
}

/**
 * Aggregate posts into dimension buckets using the metric's aggregation kind:
 * weighted-rate buckets are Σnumerator ÷ Σreach (×100); mean/score-mean buckets
 * average the per-post values. Buckets below MIN_RANK_SAMPLE are marked
 * rankable=false and sorted last so a 1-2 post fluke can't top the chart.
 */
function bucketsForMetric(
  posts: AirtableRecord[],
  getKey: (r: AirtableRecord) => string,
  metric: MetricOption,
): DimBucket[] {
  const groups = new Map<
    string,
    { num: number; reach: number; sum: number; n: number; count: number }
  >();
  for (const r of posts) {
    const key = getKey(r) || "untagged";
    const g =
      groups.get(key) ?? { num: 0, reach: 0, sum: 0, n: 0, count: 0 };
    g.count += 1;
    if (metric.kind === "weighted-rate" && metric.numerator) {
      const reach = effectiveReach(toPost(r));
      if (reach > 0) {
        g.num += metric.numerator(r);
        g.reach += reach;
      }
    } else {
      const v = metric.getMetric(r);
      if (v !== undefined && Number.isFinite(v)) {
        g.sum += v;
        g.n += 1;
      }
    }
    groups.set(key, g);
  }
  return Array.from(groups.entries())
    .map(([label, g]) => ({
      label,
      value:
        metric.kind === "weighted-rate"
          ? g.reach > 0
            ? (g.num / g.reach) * 100
            : 0
          : g.n > 0
            ? g.sum / g.n
            : 0,
      count: g.count,
      rankable: g.count >= MIN_RANK_SAMPLE,
    }))
    .sort((a, b) => {
      if (a.rankable !== b.rankable) return a.rankable ? -1 : 1;
      return b.value - a.value;
    });
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
): boolean[] {
  if (posts.length === 0) return options.map(() => false);
  return options.map((opt) => {
    let filled = 0;
    for (const r of posts) {
      const v = opt.getMetric(r);
      if (v !== undefined && Number.isFinite(v) && v !== 0) filled++;
    }
    return filled / posts.length >= MIN_FILL_RATE;
  });
}

export default function DimensionSlicer({ posts }: DimensionSlicerProps) {
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
    () => computeMetricAvailability(posts, METRIC_OPTIONS),
    [posts],
  );

  // Auto-fall-back to a populated option if the current selection became empty
  // (e.g. due to platform filter change). Only runs when availability changes.
  useEffect(() => {
    if (!dimAvailable[dimIndex]) {
      const firstAvail = dimAvailable.findIndex(Boolean);
      // Fallback-to-available-option sync; only fires when availability changes.
      // eslint-disable-next-line react-hooks/set-state-in-effect
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

  // Buckets aggregated by the metric's kind (weighted-rate / mean / score-mean),
  // with sub-MIN_RANK_SAMPLE buckets marked rankable=false and sorted last.
  const buckets = useMemo(
    () =>
      bucketsForMetric(posts, dim.getKey, metric).filter(
        (g) => g.label !== "untagged" && g.label !== "",
      ),
    [posts, dim, metric],
  );

  const chartData = useMemo(() => {
    return {
      labels: buckets.map(
        (g) => `${g.label} (${g.count})${g.rankable ? "" : " *"}`,
      ),
      datasets: [
        {
          label: metric.label,
          data: buckets.map((g) => g.value),
          // Sub-sample buckets (rankable=false) are dimmed so they read as
          // "not enough data to rank", never as a confident winner.
          backgroundColor: buckets.map((g) =>
            g.rankable ? colors.series[0] + "80" : colors.series[0] + "26",
          ),
          borderColor: buckets.map((g) =>
            g.rankable ? colors.series[0] : colors.series[0] + "55",
          ),
          borderWidth: 1,
        },
      ],
    };
  }, [buckets, metric, colors]);

  // Bucket-label lookup (chart bar index → raw bucket key, since the chart
  // labels include the count suffix like "Question (49)").
  const bucketKeys = useMemo(() => buckets.map((g) => g.label), [buckets]);

  // Per-group raw metric values. Used to detect outliers and surface the
  // "remove this one post and the average halves" callout. We deliberately
  // rebuild this here rather than refactoring groupByDimension to avoid
  // ripple changes across every other caller.
  const groupValues = useMemo(() => {
    const map = new Map<string, number[]>();
    for (const r of posts) {
      const key = dim.getKey(r) || "untagged";
      if (key === "untagged" || key === "") continue;
      const v = metric.getMetric(r);
      if (v === undefined || !Number.isFinite(v)) continue;
      const arr = map.get(key) ?? [];
      arr.push(v);
      map.set(key, arr);
    }
    return map;
  }, [posts, dim, metric]);

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
          <label className="text-xs flex items-center gap-1" style={{ color: "var(--text-secondary)" }}>
            Metric
            {glossaryFor(METRIC_OPTIONS[metricIndex].label) && (
              <InfoTooltip
                text={glossaryFor(METRIC_OPTIONS[metricIndex].label)!}
                label={`What is ${METRIC_OPTIONS[metricIndex].label}?`}
              />
            )}
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
          getMetricValue={(r) => metric.getMetric(r)}
          formatMetric={metric.format}
          onClose={() => setDrilldownBucket(null)}
        />
      )}
    </ChartCard>
  );
}
