"use client";

import { useMemo } from "react";
import { Line, Bar } from "react-chartjs-2";
import "@/lib/chartSetup";
import { useChartTheme } from "@/lib/useChartTheme";
import { getPlatformConfig, platformSortOrder } from "@/lib/platforms";
import KPICard from "./KPICard";
import ChartCard from "./ChartCard";
import InfoTooltip from "./InfoTooltip";
import { glossaryFor } from "@/lib/metricGlossary";
import AlertsFeed from "./AlertsFeed";
import WeeklySummary from "./WeeklySummary";
import {
  num,
  str,
  formatNumber,
  formatPercent,
  pctChange,
  topPosts,
  sumField,
  recordReach,
  weightedEngagementRate,
  groupByPlatform,
  getPlatformKeys,
  buildUnifiedDates,
  alignToDateArrayNullable,
} from "@/lib/utils";
import { toPost } from "@/lib/types";
import {
  saveRate,
  engagementScore,
  reachScore,
  engagementScoreBreakdown,
  reachScoreBreakdown,
  type ScoreComponent,
} from "@/lib/derivedMetrics";
import type { AirtableRecord } from "@/lib/utils";

/**
 * OverviewDeepDive — the analytical layer that used to live at the bottom of the
 * Overview/Pulse tab: the quality KPI row (ER, Save Rate, composite scores), the
 * Instagram 30-day period tiles, the weekly summary, the four trend charts, and
 * the Top 5 posts grid.
 *
 * It was lifted out verbatim (math unchanged) when the Overview tab was slimmed
 * to a strict 60-second executive read. This component is intentionally NOT
 * wired into any tab yet — it is parked here so the work is preserved for the
 * content-operator workspace redesign (Insights/Planning "what worked → what to
 * make → when to post" loop), which will re-home these panels deliberately.
 *
 * Props mirror the old Overview signature so it can be dropped in unchanged.
 */

function buildScoreTooltip(
  headline: string,
  breakdowns: ScoreComponent[][],
): string {
  if (breakdowns.length === 0) {
    return `${headline} No scored posts in this period yet.`;
  }
  const byLabel = new Map<
    string,
    { points: number[]; raws: string[]; max: number; isPct: boolean }
  >();
  for (const breakdown of breakdowns) {
    for (const c of breakdown) {
      const entry =
        byLabel.get(c.label) ??
        { points: [], raws: [], max: c.max, isPct: c.rawDisplay.endsWith("%") };
      entry.points.push(c.points);
      entry.raws.push(c.rawDisplay);
      byLabel.set(c.label, entry);
    }
  }

  const mean = (xs: number[]) =>
    xs.length ? xs.reduce((s, x) => s + x, 0) / xs.length : 0;

  const lines = Array.from(byLabel.entries()).map(([label, e]) => {
    const avgPoints = mean(e.points);
    const rawAvg = e.isPct
      ? `${mean(e.raws.map((r) => parseFloat(r) || 0)).toFixed(2)}%`
      : `${Math.round(mean(e.raws.map((r) => parseFloat(r) || 0)))}`;
    return `• ${label} ${rawAvg} → ${avgPoints.toFixed(1)} / ${e.max.toFixed(0)} pts`;
  });

  return `${headline} Averaged across ${breakdowns.length} scored post${
    breakdowns.length === 1 ? "" : "s"
  }: ${lines.join("  ")}`;
}

interface OverviewDeepDiveProps {
  posts: AirtableRecord[];
  dailyMetrics: AirtableRecord[];
  periodFacts?: AirtableRecord[];
  alerts: AirtableRecord[];
  weeklySummaries: AirtableRecord[];
  prevPosts: AirtableRecord[];
  onSelectPost: (post: AirtableRecord) => void;
}

export default function OverviewDeepDive({
  posts,
  dailyMetrics,
  periodFacts = [],
  alerts,
  weeklySummaries,
  prevPosts,
  onSelectPost,
}: OverviewDeepDiveProps) {
  const { defaultOptions, lineChartOptions } = useChartTheme();

  const platformMap = useMemo(
    () => groupByPlatform(dailyMetrics),
    [dailyMetrics],
  );
  const platformKeys = useMemo(
    () => getPlatformKeys(dailyMetrics),
    [dailyMetrics],
  );

  const quality = useMemo(() => {
    const avgER = weightedEngagementRate(posts) * 100;
    const prevAvgER = weightedEngagementRate(prevPosts) * 100;

    const postsWithReach = posts.filter((p) => recordReach(p) > 0);
    const avgSaveRate =
      postsWithReach.length > 0
        ? postsWithReach.reduce((sum, p) => {
            const v = saveRate(toPost(p));
            return sum + (v ?? 0);
          }, 0) / postsWithReach.length
        : undefined;

    const engScores = posts
      .map((p) => engagementScore(toPost(p)))
      .filter((v): v is number => v !== undefined);
    const avgEngScore =
      engScores.length > 0
        ? engScores.reduce((a, b) => a + b, 0) / engScores.length
        : undefined;

    const reachScores = posts
      .map((p) => reachScore(toPost(p)))
      .filter((v): v is number => v !== undefined);
    const avgReachScore =
      reachScores.length > 0
        ? reachScores.reduce((a, b) => a + b, 0) / reachScores.length
        : undefined;

    const engBreakdowns = posts
      .map((p) => engagementScoreBreakdown(toPost(p)))
      .filter((v): v is ScoreComponent[] => v !== undefined);
    const reachBreakdowns = posts
      .map((p) => reachScoreBreakdown(toPost(p)))
      .filter((v): v is ScoreComponent[] => v !== undefined);

    const engScoreTooltip = buildScoreTooltip(
      "Engagement quality vs platform norms (0–100). 50 = on par with typical for our size, 100 = aspirational. Components benchmarked per platform.",
      engBreakdowns,
    );
    const reachScoreTooltip = buildScoreTooltip(
      "Distribution vs platform norms (0–100). 50 = on par with typical for our size, 100 = aspirational. Components benchmarked per platform.",
      reachBreakdowns,
    );

    const postsByPlatform = new Map<string, typeof posts>();
    for (const p of posts) {
      const k = str(p.fields["Platform"]);
      if (!k) continue;
      if (!postsByPlatform.has(k)) postsByPlatform.set(k, []);
      postsByPlatform.get(k)!.push(p);
    }

    const breakdownER = Array.from(postsByPlatform.entries()).map(
      ([platform, ps]) => ({
        platform,
        value: `${(weightedEngagementRate(ps) * 100).toFixed(1)}%`,
      }),
    );

    const breakdownSaveRate = Array.from(postsByPlatform.entries()).map(
      ([platform, ps]) => {
        const withReach = ps.filter((p) => recordReach(p) > 0);
        const avg =
          withReach.length > 0
            ? withReach.reduce((s, p) => s + (saveRate(toPost(p)) ?? 0), 0) /
              withReach.length
            : 0;
        return { platform, value: `${(avg * 100).toFixed(2)}%` };
      },
    );

    return {
      avgER,
      erChange: prevAvgER > 0 ? pctChange(avgER, prevAvgER) : undefined,
      erNew: prevAvgER === 0 && avgER > 0,
      avgSaveRate,
      avgEngScore,
      avgReachScore,
      engScoreTooltip,
      reachScoreTooltip,
      breakdownER,
      breakdownSaveRate,
    };
  }, [posts, prevPosts]);

  // Instagram 30-day rolling period figures (read off the latest period_aggregate
  // row, never date-gated or summed).
  const igPeriodTiles = useMemo(() => {
    const igRows = periodFacts
      .filter(
        (r) => str(r.fields["Platform"]).toLowerCase().trim() === "instagram",
      )
      .filter(
        (r) => str(r.fields["Period Source"]).trim() === "period_aggregate",
      );
    if (igRows.length === 0) return [];
    const latest = [...igRows].sort((a, b) =>
      str(b.fields["Date"]).localeCompare(str(a.fields["Date"])),
    )[0];

    const cols: { field: string; label: string }[] = [
      { field: "Profile Views (30d)", label: "Profile Views" },
      { field: "Accounts Engaged (30d)", label: "Accounts Engaged" },
      { field: "Interactions (30d)", label: "Interactions" },
    ];
    return cols.flatMap(({ field, label }) => {
      const raw = latest.fields[field];
      if (raw === null || raw === undefined || raw === "") return [];
      return [{ label, value: formatNumber(num(raw)) }];
    });
  }, [periodFacts]);

  const allDates = useMemo(
    () =>
      buildUnifiedDates(...platformKeys.map((k) => platformMap.get(k) ?? [])),
    [platformKeys, platformMap],
  );

  const followerChartData = useMemo(() => {
    const labels = allDates.map((d) => d.slice(5));
    return {
      labels,
      datasets: platformKeys.map((key) => {
        const config = getPlatformConfig(key);
        const metrics = platformMap.get(key) ?? [];
        return {
          label: config.label,
          data: alignToDateArrayNullable(metrics, allDates, "Followers"),
          borderColor: config.color,
          backgroundColor: config.colorFill,
          fill: false,
          tension: 0.3,
          pointRadius: 0,
          spanGaps: false,
        };
      }),
    };
  }, [platformKeys, platformMap, allDates]);

  const erChartData = useMemo(() => {
    const labels = allDates.map((d) => d.slice(5));
    return {
      labels,
      datasets: platformKeys.map((key) => {
        const config = getPlatformConfig(key);
        const metrics = platformMap.get(key) ?? [];
        return {
          label: `${config.label} ER`,
          data: alignToDateArrayNullable(
            metrics,
            allDates,
            "Engagement Rate",
          ).map((v) => (v === null ? null : v * 100)),
          borderColor: config.color,
          tension: 0.3,
          pointRadius: 0,
          spanGaps: false,
        };
      }),
    };
  }, [platformKeys, platformMap, allDates]);

  const postsPerWeekData = useMemo(() => {
    const weeks = new Map<string, Map<string, number>>();
    const platformsSeen = new Set<string>();

    for (const p of posts) {
      const dateStr = str(p.fields["Published At"]);
      if (!dateStr) continue;
      const d = new Date(dateStr);
      const weekStart = new Date(d);
      weekStart.setUTCDate(d.getUTCDate() - d.getUTCDay());
      const week = weekStart.toISOString().split("T")[0];
      const platform =
        str(p.fields["Platform"]).toLowerCase().trim() || "other";
      platformsSeen.add(platform);

      const row = weeks.get(week) ?? new Map<string, number>();
      row.set(platform, (row.get(platform) ?? 0) + 1);
      weeks.set(week, row);
    }

    const sortedWeeks = Array.from(weeks.keys()).sort((a, b) =>
      a.localeCompare(b),
    );
    const platforms = Array.from(platformsSeen).sort(
      (a, b) => platformSortOrder(a) - platformSortOrder(b),
    );

    return {
      labels: sortedWeeks.map((w) => w.slice(5)),
      datasets: platforms.map((key) => {
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
  }, [posts]);

  const postsPerWeekOptions = {
    ...defaultOptions,
    scales: {
      x: { ...defaultOptions.scales.x, stacked: true },
      y: { ...defaultOptions.scales.y, stacked: true },
    },
  };

  const top5 = useMemo(
    () => topPosts(posts, "Engagement Rate", 5, { minImpressions: 50 }),
    [posts],
  );

  const followerChartOptions = {
    ...lineChartOptions,
    scales: {
      ...lineChartOptions.scales,
      y: { ...lineChartOptions.scales.y, beginAtZero: false },
    },
  };

  return (
    <div className="space-y-6">
      {/* Quality KPI row */}
      <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-4 gap-3">
        <KPICard
          title="Avg Engagement Rate"
          value={formatPercent(quality.avgER)}
          change={quality.erChange}
          isNew={quality.erNew}
          tooltip={`${glossaryFor("Engagement Rate")} Reach-weighted: total engagement ÷ total reach across posts, so larger posts count more (not an unweighted average of per-post rates).`}
          breakdown={quality.breakdownER}
        />
        <KPICard
          title="Avg Save Rate"
          value={
            quality.avgSaveRate !== undefined
              ? formatPercent(quality.avgSaveRate * 100)
              : "—"
          }
          tooltip={glossaryFor("Save Rate")}
          breakdown={quality.breakdownSaveRate}
        />
        <KPICard
          title="Engagement Score"
          value={
            quality.avgEngScore !== undefined
              ? quality.avgEngScore.toFixed(1)
              : "—"
          }
          tooltip={quality.engScoreTooltip}
        />
        <KPICard
          title="Reach Score"
          value={
            quality.avgReachScore !== undefined
              ? quality.avgReachScore.toFixed(1)
              : "—"
          }
          tooltip={quality.reachScoreTooltip}
        />
      </div>

      {/* Instagram 30-day period figures */}
      {igPeriodTiles.length > 0 && (
        <div
          className="rounded-xl p-4"
          style={{
            background: "var(--bg-card)",
            border: "1px solid var(--border)",
          }}
        >
          <div className="flex items-center gap-1.5 mb-3">
            <span
              className="text-xs font-medium"
              style={{ color: "var(--text-secondary)" }}
            >
              Instagram · last 30 days
            </span>
            <InfoTooltip
              text="Instagram-reported rolling 30-day totals, read from the latest snapshot. These are platform period figures, NOT a sum of the days in your selected date range, so they do not change when you change the range and are never added across days."
              label="What are the Instagram 30-day figures?"
            />
          </div>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            {igPeriodTiles.map((t) => (
              <div key={t.label} className="flex flex-col gap-0.5">
                <span
                  className="text-[11px]"
                  style={{ color: "var(--text-secondary)" }}
                >
                  {t.label} <span style={{ opacity: 0.7 }}>(30d)</span>
                </span>
                <span className="text-xl font-bold">{t.value}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Weekly Summary */}
      <WeeklySummary summaries={weeklySummaries} />

      {/* Charts */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <ChartCard title="Follower Growth">
          <Line data={followerChartData} options={followerChartOptions} />
        </ChartCard>
        <ChartCard title="Engagement Rate Trend (%)">
          <Line data={erChartData} options={lineChartOptions} />
        </ChartCard>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <ChartCard title="Posts Per Week">
          <Bar data={postsPerWeekData} options={postsPerWeekOptions} />
        </ChartCard>
        <AlertsFeed alerts={alerts} posts={posts} onSelectPost={onSelectPost} />
      </div>

      {/* Top 5 Posts */}
      <div
        className="rounded-xl p-5"
        style={{
          background: "var(--bg-card)",
          border: "1px solid var(--border)",
        }}
      >
        <h3
          className="text-sm font-medium mb-4"
          style={{ color: "var(--text-secondary)" }}
        >
          Top 5 Posts by Engagement Rate
        </h3>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-4">
          {top5.map((post, i) => {
            const caption = str(post.fields["Caption"]).slice(0, 120);
            const platform = str(post.fields["Platform"]);
            const postType = str(post.fields["Post Type"]);
            const er = num(post.fields["Engagement Rate"]) * 100;
            const reach = recordReach(post);
            const likes = num(post.fields["Likes"]);
            const saves = num(post.fields["Saves"]);
            const shares = num(post.fields["Shares"]);
            const comments = num(post.fields["Comments"]);
            const mediaUrl = str(post.fields["Media URL"]);
            const publishedAt = str(post.fields["Published At"]).split("T")[0];
            const config = getPlatformConfig(platform);

            return (
              <div
                key={post.id || i}
                className="rounded-lg p-4 space-y-3 flex flex-col"
                style={{
                  background: "var(--bg-secondary)",
                  border: "1px solid var(--border)",
                }}
              >
                <div className="flex items-center justify-between">
                  <span
                    className="text-[10px] px-2 py-0.5 rounded font-semibold capitalize"
                    style={{ background: config.colorBg, color: config.color }}
                  >
                    {config.label}
                  </span>
                  <span
                    className="text-[10px] capitalize"
                    style={{ color: "var(--text-secondary)" }}
                  >
                    {postType}
                  </span>
                </div>
                <p
                  className="text-xs leading-relaxed flex-1"
                  style={{ color: "var(--text-primary)" }}
                >
                  {caption}
                  {caption.length >= 120 ? "..." : ""}
                </p>
                <div
                  className="text-[10px]"
                  style={{ color: "var(--text-secondary)" }}
                >
                  {publishedAt}
                </div>
                <div
                  className="grid grid-cols-2 gap-x-3 gap-y-1 text-[11px]"
                  style={{ color: "var(--text-secondary)" }}
                >
                  <span>
                    ER:{" "}
                    <strong className="text-success">{er.toFixed(2)}%</strong>
                  </span>
                  <span>Reach: {formatNumber(reach)}</span>
                  <span>Likes: {formatNumber(likes)}</span>
                  <span>Saves: {formatNumber(saves)}</span>
                  <span>Shares: {formatNumber(shares)}</span>
                  <span>Comments: {formatNumber(comments)}</span>
                </div>
                {mediaUrl && (
                  <a
                    href={mediaUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-1 text-[11px] font-medium mt-auto pt-1 transition-opacity hover:opacity-80 cursor-pointer"
                    style={{ color: config.color }}
                  >
                    View on {config.label}
                    <svg
                      width="12"
                      height="12"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="2"
                      aria-hidden="true"
                    >
                      <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" />
                      <polyline points="15 3 21 3 21 9" />
                      <line x1="10" y1="14" x2="21" y2="3" />
                    </svg>
                  </a>
                )}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
