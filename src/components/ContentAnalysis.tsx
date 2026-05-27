"use client";

import { useMemo, useState } from "react";
import { Bar, Scatter } from "react-chartjs-2";
import "@/lib/chartSetup";
import { CHART_COLORS, defaultOptions } from "@/lib/chartSetup";
import ChartCard from "./ChartCard";
import DimensionSlicer from "./DimensionSlicer";
import PostScorecardTable from "./PostScorecardTable";
import HashtagCharts from "./HashtagCharts";
import PostDrilldownPanel from "./PostDrilldownPanel";
import {
  num,
  str,
  avgERByDimensionStacked,
  sumByDimensionStacked,
  sumField,
} from "@/lib/utils";
import type { AirtableRecord } from "@/lib/utils";
import SubNav, { useSubNav, type SubNavItem } from "./SubNav";
import AudienceDemographics from "./AudienceDemographics";
import PinterestTopPins from "./PinterestTopPins";

interface ContentAnalysisExtraProps {
  /** Instagram audience demographics records. */
  instagramAudience?: AirtableRecord[];
  /** Pinterest top pins records (Bootle's own pins, ranked). */
  pinterestTopPins?: AirtableRecord[];
}

type InsightsTab = "performance" | "audience" | "pinterest" | "hashtags";

const SUBNAV_ITEMS: ReadonlyArray<SubNavItem<InsightsTab>> = [
  { key: "performance", label: "Post performance" },
  { key: "audience", label: "Audience" },
  { key: "pinterest", label: "Pinterest pins" },
  { key: "hashtags", label: "Hashtags" },
];

const VALID_KEYS: ReadonlyArray<InsightsTab> = [
  "performance",
  "audience",
  "pinterest",
  "hashtags",
];

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

interface ContentAnalysisProps extends ContentAnalysisExtraProps {
  posts: AirtableRecord[];
  timezone?: string;
}

export default function ContentAnalysis({
  posts,
  timezone = "",
  instagramAudience = [],
  pinterestTopPins = [],
}: ContentAnalysisProps) {
  const [subTab, setSubTab] = useSubNav<InsightsTab>(
    "insights",
    "performance",
    VALID_KEYS,
  );
  const [metricKey, setMetricKey] = useState<MetricKey>("engagement");
  const metric = METRICS[metricKey];

  // Drilldown shared across stacked bars, scatter, and hashtag bars. Holds
  // the filtered post subset, the human-readable label of what was clicked,
  // and the metric to sort by inside the panel so posts rank by the same
  // measure that produced the click.
  const [drilldown, setDrilldown] = useState<{
    posts: AirtableRecord[];
    label: string;
    metricLabel: string;
    getMetricValue: (r: AirtableRecord) => number | undefined;
    formatMetric: (v: number) => string;
  } | null>(null);

  // Precompute index by (Post Type, Content Theme) for fast drilldown lookup.
  const postsByTypeTheme = useMemo(() => {
    const map = new Map<string, AirtableRecord[]>();
    for (const p of posts) {
      const t = str(p.fields["Post Type"]) || "unknown";
      const th = str(p.fields["Content Theme"]) || "untagged";
      const key = `${t}${th}`;
      const arr = map.get(key);
      if (arr) arr.push(p);
      else map.set(key, [p]);
    }
    return map;
  }, [posts]);

  const openTypeThemeDrill = (postType: string, theme: string) => {
    const cleanType = postType.replace(/\s*\(\d+\)$/, "");
    const cleanTheme = theme.replace(/\s*\(\d+\)$/, "");
    const subset =
      postsByTypeTheme.get(`${cleanType}${cleanTheme}`) ?? [];
    if (subset.length === 0) return;
    const get = metricGetter(metricKey);
    const isRate = !metric.additive;
    setDrilldown({
      posts: subset,
      label: `${cleanType} × ${cleanTheme}`,
      metricLabel: metric.label,
      // ER stored as 0-1 in Airtable but displayed as %; multiply when the
      // active metric is a rate so the drilldown column matches the chart.
      getMetricValue: (r) => {
        const v = get(r);
        return v === undefined ? undefined : isRate ? v * 100 : v;
      },
      formatMetric: metric.formatter,
    });
  };

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

  // Click handlers for Post Type × Theme stacked bars. The Chart.js onClick
  // returns elements with the dataIndex (primary axis position) and
  // datasetIndex (segment). We resolve those back to label strings via the
  // chart's own labels and dataset metadata.
  const onFormatBarClick = (
    _e: unknown,
    elements: Array<{ datasetIndex: number; index: number }>,
    chart: { data: { labels?: unknown[]; datasets: Array<{ label?: string }> } },
  ) => {
    if (!elements.length) return;
    const { datasetIndex, index } = elements[0];
    const primaryLabel = String(chart.data.labels?.[index] ?? "");
    const segmentLabel = chart.data.datasets[datasetIndex]?.label ?? "";
    openTypeThemeDrill(primaryLabel, segmentLabel);
  };

  const onThemeBarClick = (
    _e: unknown,
    elements: Array<{ datasetIndex: number; index: number }>,
    chart: { data: { labels?: unknown[]; datasets: Array<{ label?: string }> } },
  ) => {
    if (!elements.length) return;
    const { datasetIndex, index } = elements[0];
    const themeLabel = String(chart.data.labels?.[index] ?? "");
    const typeLabel = chart.data.datasets[datasetIndex]?.label ?? "";
    openTypeThemeDrill(typeLabel, themeLabel);
  };

  // Stacked when additive (sums sum), grouped when a rate (sums don't sum).
  const chartOptions = useMemo(() => {
    const formatter = metric.formatter;
    return {
      ...defaultOptions,
      onClick: onFormatBarClick,
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
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [metric.additive, metric.formatter, postsByTypeTheme]);

  const chartOptionsHorizontal = useMemo(
    () => {
      const formatter = metric.formatter;
      return {
        ...chartOptions,
        onClick: onThemeBarClick,
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
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [chartOptions, metric.additive, metric.formatter, postsByTypeTheme],
  );

  // Build the scatter point array AND keep a parallel index of the source
  // post records so a click can resolve back to the original post.
  const scatterPosts = useMemo(
    () => posts.filter((p) => num(p.fields["Reach"]) > 0),
    [posts],
  );

  const scatterData = useMemo(() => {
    return {
      datasets: [
        {
          label: "Posts",
          data: scatterPosts.map((p) => ({
            x: (num(p.fields["Saves"]) / num(p.fields["Reach"])) * 100,
            y: (num(p.fields["Shares"]) / num(p.fields["Reach"])) * 100,
          })),
          backgroundColor: CHART_COLORS.purple + "80",
          pointRadius: 5,
          pointHoverRadius: 7,
        },
      ],
    };
  }, [scatterPosts]);

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
    onClick: (
      _e: unknown,
      elements: Array<{ index: number }>,
    ) => {
      if (!elements.length) return;
      const post = scatterPosts[elements[0].index];
      if (!post) return;
      // Scatter axes are Save Rate (x) and Share Rate (y); rank by Save Rate
      // since that's the higher-intent signal and matches what users tend to
      // be searching for when clicking outliers on this chart.
      setDrilldown({
        posts: [post],
        label: `Post ${str(post.fields["Post ID"]).slice(-10)} — Save vs Share`,
        metricLabel: "Save Rate",
        getMetricValue: (r) => {
          const reach = num(r.fields["Reach"]);
          if (reach <= 0) return undefined;
          return (num(r.fields["Saves"]) / reach) * 100;
        },
        formatMetric: (v: number) => `${v.toFixed(2)}%`,
      });
    },
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

  const emptyPostsBanner = (
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

  return (
    <div className="space-y-4">
      <SubNav
        storageKey="insights"
        items={SUBNAV_ITEMS}
        value={subTab}
        onChange={setSubTab}
      />

      {subTab === "performance" && posts.length === 0 && emptyPostsBanner}
      {subTab === "performance" && posts.length > 0 && (
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
                    metricKey === k
                      ? "var(--accent-purple)"
                      : "var(--bg-secondary)",
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

          <ChartCard
            title="Save Rate vs Share Rate"
            tooltip="Intent signals — saves = personal value, shares = social value. Click a point to drill into the post."
          >
            <Scatter data={scatterData} options={scatterOptions} />
          </ChartCard>
        </div>
      )}

      {subTab === "audience" && (
        <AudienceDemographics records={instagramAudience} />
      )}

      {subTab === "pinterest" && (
        <PinterestTopPins
          records={pinterestTopPins}
          posts={posts}
          timezone={timezone}
        />
      )}

      {subTab === "hashtags" && (
        <HashtagCharts
          posts={posts}
          onSelectHashtag={(tag, subset) =>
            // Hashtag charts plot frequency + avg ER; ER is the more useful
            // sort for inspecting which posts under a tag actually performed.
            setDrilldown({
              posts: subset,
              label: `Hashtag #${tag}`,
              metricLabel: "Engagement Rate",
              getMetricValue: (r) => num(r.fields["Engagement Rate"]) * 100,
              formatMetric: (v: number) => `${v.toFixed(2)}%`,
            })
          }
        />
      )}

      {drilldown && (
        <PostDrilldownPanel
          posts={drilldown.posts}
          bucketLabel={drilldown.label}
          metricLabel={drilldown.metricLabel}
          getMetricValue={drilldown.getMetricValue}
          formatMetric={drilldown.formatMetric}
          timezone={timezone}
          onClose={() => setDrilldown(null)}
        />
      )}
    </div>
  );
}
