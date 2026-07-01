"use client";

import { useMemo } from "react";
import { Bar, Line } from "react-chartjs-2";
import "@/lib/chartSetup";
import { useChartTheme } from "@/lib/useChartTheme";
import { getPlatformConfig } from "@/lib/platforms";
import ChartCard from "./ChartCard";
import { toPost } from "@/lib/types";
import { engagementScore, reachScore } from "@/lib/derivedMetrics";
import {
  num,
  str,
  formatNumber,
  formatPercent,
  weightedEngagementRate,
  sumField,
  sumReach,
  recordReach,
  hasRealReach,
  hasRealImpressions,
  latestViews,
  groupByPlatform,
  getPlatformKeys,
  buildUnifiedDates,
  alignToDateArray,
  alignToDateArrayNullable,
  postEngagement,
} from "@/lib/utils";
import type { AirtableRecord } from "@/lib/utils";

interface PlatformCompareProps {
  posts: AirtableRecord[];
  dailyMetrics: AirtableRecord[];
}

interface PlatformKPIs {
  followers: number;
  avgER: number;
  // null = the platform does not report this account metric (e.g. Instagram
  // retired account impressions). Rendered as an em-dash, never as a real 0 — a
  // structural blank is not a measured zero. (FB account reach is no longer a
  // structural blank: from 2026-06-20 it is a daily_proxy value.)
  totalReach: number | null;
  totalImpressions: number | null;
  // IG account Views (Meta's replacement for the retired IG account impressions),
  // exposed only as a rolling 30-day aggregate on the newest row — a latest value,
  // NEVER a sum. null = platform does not report account Views → em-dash.
  totalViews: number | null;
  posts: number;
  avgSaves: number;
  avgShares: number;
  profileViews: number | null;
  // Expansion metrics
  reachPerPost: number;
  engagementPerPost: number;
  avgEngScore: number | undefined;
  avgReachScore: number | undefined;
}

/** Sum a real-metric field, or null when no row carries a real value for it. */
function sumOrNull(
  rows: AirtableRecord[],
  field: string,
  sumFn: (rows: AirtableRecord[]) => number,
): number | null {
  return rows.length > 0 ? sumFn(rows) : null;
}

/** Mean of defined composite scores across a platform's posts. */
function avgScore(
  records: AirtableRecord[],
  fn: (p: ReturnType<typeof toPost>) => number | undefined,
): number | undefined {
  const vals = records
    .map((r) => fn(toPost(r)))
    .filter((v): v is number => v !== undefined);
  if (vals.length === 0) return undefined;
  return vals.reduce((a, b) => a + b, 0) / vals.length;
}

/** ISO-week (Sunday start, UTC) key for a post's Published At. "" if undated. */
function weekKey(record: AirtableRecord): string {
  const dateStr = str(record.fields["Published At"]);
  if (!dateStr) return "";
  const d = new Date(dateStr);
  if (Number.isNaN(d.getTime())) return "";
  const weekStart = new Date(d);
  weekStart.setUTCDate(d.getUTCDate() - d.getUTCDay());
  return weekStart.toISOString().split("T")[0];
}

function PlatformCard({
  platformKey,
  kpis,
}: {
  platformKey: string;
  kpis: PlatformKPIs;
}) {
  const config = getPlatformConfig(platformKey);

  // A null structural metric (e.g. IG account impressions) renders as an
  // em-dash — the platform doesn't report it, which is not a 0.
  const fmtOrDash = (v: number | null) => (v === null ? "—" : formatNumber(v));

  const rows = [
    { label: "Followers", value: formatNumber(kpis.followers) },
    { label: "Posts", value: String(kpis.posts) },
    { label: "Avg ER", value: formatPercent(kpis.avgER) },
    { label: "Total Reach", value: fmtOrDash(kpis.totalReach) },
    { label: "Impressions", value: fmtOrDash(kpis.totalImpressions) },
    { label: "Views (30d)", value: fmtOrDash(kpis.totalViews) },
    { label: "Reach / Post", value: formatNumber(kpis.reachPerPost) },
    { label: "Eng / Post", value: formatNumber(kpis.engagementPerPost) },
    { label: "Profile Views", value: fmtOrDash(kpis.profileViews) },
  ];

  // Per-post benchmark scores, shown as a compact 0–100 pair so channels are
  // comparable on the same scale (50 = on par for that platform).
  const scorePills = [
    { label: "Eng Score", value: kpis.avgEngScore },
    { label: "Reach Score", value: kpis.avgReachScore },
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
      <div className="flex gap-2 pt-1">
        {scorePills.map((s) => (
          <div
            key={s.label}
            className="flex-1 rounded-lg px-2 py-1.5"
            style={{ background: "var(--bg-secondary)" }}
          >
            <p className="text-[10px]" style={{ color: "var(--text-secondary)" }}>
              {s.label}
            </p>
            <p className="text-sm font-bold" style={{ color: config.color }}>
              {s.value !== undefined ? s.value.toFixed(0) : "—"}
              <span
                className="text-[10px] font-normal ml-0.5"
                style={{ color: "var(--text-secondary)" }}
              >
                /100
              </span>
            </p>
          </div>
        ))}
      </div>
      <p className="text-[10px]" style={{ color: "var(--text-secondary)" }}>
        Scores are benchmarked to each platform&apos;s own norms (50 = on par for
        that platform), so a low score means under-performing for that channel —
        not that the channel is worse than another.
      </p>
    </div>
  );
}

export default function PlatformCompare({
  posts,
  dailyMetrics,
}: PlatformCompareProps) {
  const { defaultOptions, lineChartOptions } = useChartTheme();

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
      const n = platformPosts.length;

      // Account-grain volume is summed PER METRIC only from rows that carry a
      // real measurement for that metric (WEBDEV-146), matching Overview — so
      // one metric's absence renders as an em-dash, never a false 0. A platform
      // with zero real rows for a metric gets null, not 0 (e.g. IG impressions;
      // FB reach is a daily_proxy value from 2026-06-20, so it is summed).
      // Source: Account Daily Facts.
      const realReachRows = metrics.filter(hasRealReach);
      const realImprRows = metrics.filter(hasRealImpressions);
      const profileViewRows = metrics.filter(
        (m) => num(m.fields["Profile Views"]) > 0,
      );
      const totalReach = sumOrNull(realReachRows, "Reach", sumReach);
      // Per-post reach uses the posts' own reach (Pinterest-substituted), not
      // the daily-metrics total, so it reflects what each post actually pulled.
      const postReachTotal = platformPosts.reduce(
        (s, p) => s + recordReach(p),
        0,
      );
      // Platform-reported engagement (Engagement field), not a component sum —
      // see postEngagement: Meta includes Reposts, Pinterest includes PIN_CLICK.
      const postEngagementTotal = platformPosts.reduce(
        (s, p) => s + postEngagement(p),
        0,
      );

      result[key] = {
        followers: latest ? num(latest.fields["Followers"]) : 0,
        avgER: weightedEngagementRate(platformPosts) * 100,
        totalReach,
        totalImpressions: sumOrNull(realImprRows, "Impressions", (rows) =>
          sumField(rows, "Impressions"),
        ),
        // Newest-row 30-day aggregate (IG), NOT a sum — see PlatformKPIs.totalViews.
        totalViews: latestViews(metrics),
        posts: n,
        avgSaves: n > 0 ? sumField(platformPosts, "Saves") / n : 0,
        avgShares: n > 0 ? sumField(platformPosts, "Shares") / n : 0,
        profileViews: sumOrNull(profileViewRows, "Profile Views", (rows) =>
          sumField(rows, "Profile Views"),
        ),
        reachPerPost: n > 0 ? postReachTotal / n : 0,
        engagementPerPost: n > 0 ? postEngagementTotal / n : 0,
        avgEngScore: avgScore(platformPosts, engagementScore),
        avgReachScore: avgScore(platformPosts, reachScore),
      };
    }

    return result;
  }, [platformKeys, metricsMap, postsMap]);

  // Unified date array
  const allDates = useMemo(
    () =>
      buildUnifiedDates(...platformKeys.map((k) => metricsMap.get(k) ?? [])),
    [platformKeys, metricsMap],
  );

  // ER trend comparison
  const erTrendData = useMemo(() => {
    const labels = allDates.map((d) => d.slice(5));

    return {
      labels,
      // Two lines per platform: ER (by content reach, solid) and the co-primary
      // ERF (by followers, dashed). Both are fractions → ×100; no-post days stay
      // null (gaps, not zeros — spanGaps:false). WEBDEV-295/296.
      datasets: platformKeys.flatMap((key) => {
        const config = getPlatformConfig(key);
        const metrics = metricsMap.get(key) ?? [];
        const toPct = (v: number | null) => (v === null ? null : v * 100);
        return [
          {
            label: `${config.label} ER`,
            data: alignToDateArrayNullable(metrics, allDates, "Engagement Rate").map(toPct),
            borderColor: config.color,
            tension: 0.3,
            pointRadius: 0,
            spanGaps: false,
          },
          {
            label: `${config.label} ER/follower`,
            data: alignToDateArrayNullable(metrics, allDates, "Engagement Rate Followers").map(toPct),
            borderColor: config.color,
            borderDash: [5, 4],
            tension: 0.3,
            pointRadius: 0,
            spanGaps: false,
          },
        ];
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
          // Nullable: a day with no reach value is a gap, not a 0 fill. FB reach
          // is a page_total_media_view_unique proxy from 2026-06-20 (daily_proxy);
          // before that FB account reach was empty.
          data: alignToDateArrayNullable(
            metrics,
            allDates,
            key === "pinterest" ? "Impressions" : "Reach",
          ),
          borderColor: config.color,
          backgroundColor: config.colorFill,
          fill: true,
          tension: 0.3,
          pointRadius: 0,
          spanGaps: false,
        };
      }),
    };
  }, [platformKeys, metricsMap, allDates]);

  // Posts by channel over time — stacked weekly cadence per platform.
  const postsByWeekData = useMemo(() => {
    // week -> platform -> count
    const weeks = new Map<string, Map<string, number>>();
    for (const key of platformKeys) {
      for (const p of postsMap.get(key) ?? []) {
        const w = weekKey(p);
        if (!w) continue;
        const row = weeks.get(w) ?? new Map<string, number>();
        row.set(key, (row.get(key) ?? 0) + 1);
        weeks.set(w, row);
      }
    }
    const sortedWeeks = Array.from(weeks.keys()).sort((a, b) =>
      a.localeCompare(b),
    );
    return {
      labels: sortedWeeks.map((w) => w.slice(5)),
      datasets: platformKeys.map((key) => {
        const config = getPlatformConfig(key);
        return {
          label: config.label,
          data: sortedWeeks.map((w) => weeks.get(w)?.get(key) ?? 0),
          backgroundColor: config.color + "cc",
          borderColor: config.color,
          borderWidth: 1,
          stack: "posts",
        };
      }),
    };
  }, [platformKeys, postsMap]);

  const postsByWeekOptions = useMemo(
    () => ({
      ...defaultOptions,
      scales: {
        x: { ...defaultOptions.scales.x, stacked: true },
        y: { ...defaultOptions.scales.y, stacked: true },
      },
    }),
    [defaultOptions],
  );

  // Share of voice — one horizontal stacked bar = % of total output per channel.
  const totalPosts = useMemo(
    () => platformKeys.reduce((s, k) => s + (kpiMap[k]?.posts ?? 0), 0),
    [platformKeys, kpiMap],
  );

  // Rate-based comparison (all %, internally consistent axis).
  const rateComparison = useMemo(
    () => ({
      labels: ["Avg ER %", "Save Rate %", "Comment Rate %"],
      datasets: platformKeys.map((key) => {
        const config = getPlatformConfig(key);
        const platformPosts = postsMap.get(key) ?? [];
        const reachTotal = platformPosts.reduce(
          (s, p) => s + recordReach(p),
          0,
        );
        const saves = sumField(platformPosts, "Saves");
        const comments = sumField(platformPosts, "Comments");
        const saveRatePct = reachTotal > 0 ? (saves / reachTotal) * 100 : 0;
        const commentRatePct =
          reachTotal > 0 ? (comments / reachTotal) * 100 : 0;
        return {
          label: config.label,
          data: [kpiMap[key].avgER, saveRatePct, commentRatePct],
          backgroundColor: config.color + "80",
          borderColor: config.color,
          borderWidth: 1,
        };
      }),
    }),
    [platformKeys, postsMap, kpiMap],
  );

  // Score comparison (0–100, apples-to-apples across channels).
  const scoreComparison = useMemo(
    () => ({
      labels: ["Engagement Score", "Reach Score"],
      datasets: platformKeys.map((key) => {
        const config = getPlatformConfig(key);
        const k = kpiMap[key];
        return {
          label: config.label,
          data: [k.avgEngScore ?? 0, k.avgReachScore ?? 0],
          backgroundColor: config.color + "80",
          borderColor: config.color,
          borderWidth: 1,
        };
      }),
    }),
    [platformKeys, kpiMap],
  );

  const scoreComparisonOptions = useMemo(
    () => ({
      ...defaultOptions,
      scales: {
        x: { ...defaultOptions.scales.x },
        y: { ...defaultOptions.scales.y, min: 0, max: 100 },
      },
    }),
    [defaultOptions],
  );

  // Content mix (post type) per platform — unchanged.
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

      {/* Share of voice — where our output goes */}
      {totalPosts > 0 && (
        <div
          className="rounded-xl p-5"
          style={{
            background: "var(--bg-card)",
            border: "1px solid var(--border)",
          }}
        >
          <h3
            className="text-base font-medium mb-3"
            style={{ color: "var(--text-secondary)" }}
          >
            Share of Voice ({totalPosts} posts)
          </h3>
          <div className="flex w-full h-6 rounded-md overflow-hidden">
            {platformKeys.map((key) => {
              const config = getPlatformConfig(key);
              const pct = ((kpiMap[key]?.posts ?? 0) / totalPosts) * 100;
              if (pct === 0) return null;
              return (
                <div
                  key={key}
                  style={{ width: `${pct}%`, background: config.color }}
                  title={`${config.label}: ${kpiMap[key].posts} posts (${pct.toFixed(0)}%)`}
                  className="flex items-center justify-center"
                >
                  {pct >= 8 && (
                    <span className="text-[10px] font-semibold text-white">
                      {pct.toFixed(0)}%
                    </span>
                  )}
                </div>
              );
            })}
          </div>
          <div className="flex flex-wrap gap-3 mt-2">
            {platformKeys.map((key) => {
              const config = getPlatformConfig(key);
              return (
                <span
                  key={key}
                  className="flex items-center gap-1 text-[10px]"
                  style={{ color: "var(--text-secondary)" }}
                >
                  <span
                    className="inline-block w-2 h-2 rounded-full"
                    style={{ background: config.color }}
                  />
                  {config.label} · {kpiMap[key].posts}
                </span>
              );
            })}
          </div>
        </div>
      )}

      {/* Trend Charts */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <ChartCard title="Engagement Rate Comparison">
          <Line data={erTrendData} options={lineChartOptions} />
        </ChartCard>
        <ChartCard
          title="Reach Comparison"
          tooltip="Account reach per platform. Facebook reach is a page_total_media_view_unique proxy (from 2026-06-20); Pinterest is a pin-impression sum; Instagram is directly measured. See the Methodology page."
        >
          <Line data={reachTrendData} options={lineChartOptions} />
        </ChartCard>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <ChartCard
          title="Posts by Channel Over Time"
          tooltip="Posts published per week, stacked by platform — posting cadence and channel mix over the selected period."
        >
          <Bar data={postsByWeekData} options={postsByWeekOptions} />
        </ChartCard>
        <ChartCard title="Content Mix by Platform">
          <Bar data={postTypeComparison} options={defaultOptions} />
        </ChartCard>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <ChartCard
          title="Engagement Quality (rates)"
          tooltip="Rate-based metrics on a single % axis — average engagement rate, save rate, and comment rate per platform."
        >
          <Bar data={rateComparison} options={defaultOptions} />
        </ChartCard>
        <ChartCard
          title="Benchmark Scores by Platform"
          tooltip="Per-post Engagement and Reach scores (0–100, benchmarked to EACH platform's own norms; 50 = on par for that platform). These are NOT a raw cross-platform comparison — a low Pinterest score means under-performing vs Pinterest norms, not that Pinterest is worse than Instagram. Pinterest engagement is also currently understated by a known data-completeness gap (per-pin metrics frozen/partial)."
        >
          <Bar data={scoreComparison} options={scoreComparisonOptions} />
        </ChartCard>
      </div>
    </div>
  );
}
