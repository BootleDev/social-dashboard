"use client";

import { useMemo } from "react";
import { Line, Bar } from "react-chartjs-2";
import "@/lib/chartSetup";
import { useChartTheme } from "@/lib/useChartTheme";
import { getPlatformConfig, platformSortOrder } from "@/lib/platforms";
import KPICard from "./KPICard";
import ChartCard from "./ChartCard";
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
  sumReach,
  avgField,
  groupByPlatform,
  getPlatformKeys,
  buildUnifiedDates,
  alignToDateArray,
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
 * Build a legible tooltip for a composite score from its averaged component
 * breakdowns. Shows each component's average raw input and the points it
 * contributes (out of its max), so the abstract 0–100 number becomes readable:
 *
 *   "Composite 0–100, averaged across 7 posts:
 *    • Save rate 0.2% → 3.2 / 40 pts
 *    • Engagement rate 4.3% → 5.0 / 35 pts
 *    • Comment rate 0.1% → 0.7 / 25 pts"
 *
 * `rawDisplay` is taken from the first post's component (representative format);
 * the points are averaged across all posts so they sum to the displayed score.
 */
function buildScoreTooltip(
  headline: string,
  breakdowns: ScoreComponent[][],
): string {
  if (breakdowns.length === 0) {
    return `${headline} No scored posts in this period yet.`;
  }
  // Aggregate component contributions BY LABEL, not by position — different
  // platforms have different components (IG: comment/save/ER; Pinterest:
  // save/outbound-click; FB: ER) so a mixed-platform period must group each
  // component by its name and average only over the posts that have it.
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

interface OverviewProps {
  posts: AirtableRecord[];
  dailyMetrics: AirtableRecord[];
  alerts: AirtableRecord[];
  weeklySummaries: AirtableRecord[];
  prevPosts: AirtableRecord[];
  prevDailyMetrics: AirtableRecord[];
}

export default function Overview({
  posts,
  dailyMetrics,
  alerts,
  weeklySummaries,
  prevPosts,
  prevDailyMetrics,
}: OverviewProps) {
  const { colors, defaultOptions, lineChartOptions } = useChartTheme();

  const platformMap = useMemo(
    () => groupByPlatform(dailyMetrics),
    [dailyMetrics],
  );
  const platformKeys = useMemo(
    () => getPlatformKeys(dailyMetrics),
    [dailyMetrics],
  );

  // KPI calculations with proper period comparison
  const kpis = useMemo(() => {
    const totalFollowers = platformKeys.reduce((sum, key) => {
      const metrics = platformMap.get(key) ?? [];
      const latest = metrics[0];
      return sum + (latest ? num(latest.fields["Followers"]) : 0);
    }, 0);

    const prevMap = groupByPlatform(prevDailyMetrics);
    const prevFollowers = platformKeys.reduce((sum, key) => {
      const metrics = prevMap.get(key) ?? [];
      const latest = metrics[0];
      return sum + (latest ? num(latest.fields["Followers"]) : 0);
    }, 0);

    const avgER = avgField(posts, "Engagement Rate") * 100;
    const prevAvgER = avgField(prevPosts, "Engagement Rate") * 100;

    const totalReach = sumReach(dailyMetrics);
    const prevTotalReach = sumReach(prevDailyMetrics);

    const totalImpressions = sumField(dailyMetrics, "Impressions");
    const prevTotalImpressions = sumField(prevDailyMetrics, "Impressions");

    const totalProfileViews = sumField(dailyMetrics, "Profile Views");

    const totalLinkClicks = sumField(posts, "Link Clicks");
    const prevTotalLinkClicks = sumField(prevPosts, "Link Clicks");

    const totalVideoViews = sumField(posts, "Video Views");

    // Save Rate: avg across posts that have reach > 0
    const postsWithReach = posts.filter((p) => recordReach(p) > 0);
    const avgSaveRate =
      postsWithReach.length > 0
        ? postsWithReach.reduce((sum, p) => {
            const v = saveRate(toPost(p));
            return sum + (v ?? 0);
          }, 0) / postsWithReach.length
        : undefined;

    // Composite scores: median across posts that have enough data
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

    // Average each score's component contributions across the same posts, so
    // the KPI tooltip can show WHAT drives the composite (e.g. "Save rate
    // 0.2% → 3.2 / 40 pts"), not just the formula. Components sum to the score.
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

    // Per-platform breakdowns. Each KPI gets a small platform-pill row
    // so blended aggregates (e.g. Save Rate 0.1%) don't hide the fact
    // that one platform is doing all the work and another is at zero.
    const postsByPlatform = new Map<string, typeof posts>();
    for (const p of posts) {
      const k = str(p.fields["Platform"]);
      if (!k) continue;
      if (!postsByPlatform.has(k)) postsByPlatform.set(k, []);
      postsByPlatform.get(k)!.push(p);
    }

    const breakdownFollowers = platformKeys.map((k) => {
      const m = platformMap.get(k) ?? [];
      const latest = m[0];
      return {
        platform: k,
        value: formatNumber(latest ? num(latest.fields["Followers"]) : 0),
      };
    });

    const breakdownReach = platformKeys.map((k) => {
      const m = platformMap.get(k) ?? [];
      return { platform: k, value: formatNumber(sumReach(m)) };
    });

    const breakdownImpressions = platformKeys.map((k) => {
      const m = platformMap.get(k) ?? [];
      return { platform: k, value: formatNumber(sumField(m, "Impressions")) };
    });

    const breakdownPosts = Array.from(postsByPlatform.entries()).map(
      ([platform, ps]) => ({ platform, value: String(ps.length) }),
    );

    const breakdownER = Array.from(postsByPlatform.entries()).map(
      ([platform, ps]) => ({
        platform,
        value: `${(avgField(ps, "Engagement Rate") * 100).toFixed(1)}%`,
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
      totalFollowers,
      followersChange:
        prevFollowers > 0
          ? pctChange(totalFollowers, prevFollowers)
          : undefined,
      avgER,
      erChange: prevAvgER > 0 ? pctChange(avgER, prevAvgER) : undefined,
      totalReach,
      reachChange:
        prevTotalReach > 0 ? pctChange(totalReach, prevTotalReach) : undefined,
      totalImpressions,
      impressionsChange:
        prevTotalImpressions > 0
          ? pctChange(totalImpressions, prevTotalImpressions)
          : undefined,
      postsPublished: posts.length,
      avgSaveRate,
      totalProfileViews,
      totalLinkClicks,
      linkClicksChange:
        prevTotalLinkClicks > 0
          ? pctChange(totalLinkClicks, prevTotalLinkClicks)
          : undefined,
      totalVideoViews,
      avgEngScore,
      avgReachScore,
      engScoreTooltip,
      reachScoreTooltip,
      breakdownFollowers,
      breakdownReach,
      breakdownImpressions,
      breakdownPosts,
      breakdownER,
      breakdownSaveRate,
    };
  }, [
    posts,
    dailyMetrics,
    platformKeys,
    platformMap,
    prevPosts,
    prevDailyMetrics,
  ]);

  // Unified date array from all platforms
  const allDates = useMemo(
    () =>
      buildUnifiedDates(...platformKeys.map((k) => platformMap.get(k) ?? [])),
    [platformKeys, platformMap],
  );

  // Follower growth chart — dynamic datasets per platform
  const followerChartData = useMemo(() => {
    const labels = allDates.map((d) => d.slice(5));

    return {
      labels,
      datasets: platformKeys.map((key) => {
        const config = getPlatformConfig(key);
        const metrics = platformMap.get(key) ?? [];
        return {
          label: config.label,
          data: alignToDateArray(metrics, allDates, "Followers"),
          borderColor: config.color,
          backgroundColor: config.colorFill,
          fill: false,
          tension: 0.3,
          pointRadius: 0,
        };
      }),
    };
  }, [platformKeys, platformMap, allDates]);

  // Engagement rate trend — dynamic datasets per platform
  const erChartData = useMemo(() => {
    const labels = allDates.map((d) => d.slice(5));

    return {
      labels,
      datasets: platformKeys.map((key) => {
        const config = getPlatformConfig(key);
        const metrics = platformMap.get(key) ?? [];
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
  }, [platformKeys, platformMap, allDates]);

  // Posts per week, stacked by platform. Each weekly bar splits into
  // platform-coloured segments so the chart shows both total output and the
  // platform mix per week (consistent with the platform colours used across
  // the rest of the dashboard).
  const postsPerWeekData = useMemo(() => {
    // week (ISO Sunday) -> platform key -> count
    const weeks = new Map<string, Map<string, number>>();
    const platformsSeen = new Set<string>();

    for (const p of posts) {
      const dateStr = str(p.fields["Published At"]);
      if (!dateStr) continue;
      const d = new Date(dateStr);
      const weekStart = new Date(d);
      weekStart.setUTCDate(d.getUTCDate() - d.getUTCDay());
      const week = weekStart.toISOString().split("T")[0];
      const platform = str(p.fields["Platform"]).toLowerCase().trim() || "other";
      platformsSeen.add(platform);

      const row = weeks.get(week) ?? new Map<string, number>();
      row.set(platform, (row.get(platform) ?? 0) + 1);
      weeks.set(week, row);
    }

    const sortedWeeks = Array.from(weeks.keys()).sort((a, b) =>
      a.localeCompare(b),
    );
    // Order platforms by the dashboard's canonical sort where known.
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

  // Stacked bar options — same theme base, but both axes stacked so the
  // per-platform segments sum into one bar per week.
  const postsPerWeekOptions = {
    ...defaultOptions,
    scales: {
      x: { ...defaultOptions.scales.x, stacked: true },
      y: { ...defaultOptions.scales.y, stacked: true },
    },
  };

  // Top 5 posts by ER, with a 50-impression floor so a pin with 1 impression
  // and 1 click (= 100% ER) doesn't dominate the list.
  const top5 = useMemo(
    () => topPosts(posts, "Engagement Rate", 5, { minImpressions: 50 }),
    [posts],
  );

  // Follower counts move in a narrow band (e.g. 677–694). With a 0-based axis
  // the line looks dead flat, so zoom the y-axis to the actual range.
  const followerChartOptions = {
    ...lineChartOptions,
    scales: {
      ...lineChartOptions.scales,
      y: { ...lineChartOptions.scales.y, beginAtZero: false },
    },
  };

  const platformCountLabel = platformKeys
    .map((k) => getPlatformConfig(k).label)
    .join(" + ");

  if (posts.length === 0 && dailyMetrics.length === 0) {
    return (
      <div
        className="rounded-xl p-8 text-center"
        style={{
          background: "var(--bg-card)",
          border: "1px solid var(--border)",
        }}
      >
        <p className="text-sm" style={{ color: "var(--text-secondary)" }}>
          No data for this period. Try expanding the date range or check that
          the Social Data Refresher workflow is running.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* KPI Row 1 — volume */}
      <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-4 gap-3">
        <KPICard
          title="Total Followers"
          value={formatNumber(kpis.totalFollowers)}
          change={kpis.followersChange}
          tooltip={`Combined ${platformCountLabel} followers`}
          breakdown={kpis.breakdownFollowers}
        />
        <KPICard
          title="Total Reach"
          value={formatNumber(kpis.totalReach)}
          change={kpis.reachChange}
          breakdown={kpis.breakdownReach}
        />
        <KPICard
          title="Impressions"
          value={
            kpis.totalImpressions > 0
              ? formatNumber(kpis.totalImpressions)
              : "—"
          }
          change={
            kpis.totalImpressions > 0 ? kpis.impressionsChange : undefined
          }
          tooltip="Instagram retired the account-level impressions metric in 2024 (now reported as 'views'). Shows — until the Social Data Refresher is migrated to the views metric. Not a tracking gap on our end."
          breakdown={kpis.breakdownImpressions}
        />
        <KPICard
          title="Posts Published"
          value={String(kpis.postsPublished)}
          breakdown={kpis.breakdownPosts}
        />
      </div>

      {/* KPI Row 2 — quality */}
      <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-4 gap-3">
        <KPICard
          title="Avg Engagement Rate"
          value={formatPercent(kpis.avgER)}
          change={kpis.erChange}
          tooltip="Average across all posts in range"
          breakdown={kpis.breakdownER}
        />
        <KPICard
          title="Avg Save Rate"
          value={
            kpis.avgSaveRate !== undefined
              ? formatPercent(kpis.avgSaveRate * 100)
              : "—"
          }
          tooltip="Saves / Reach — strong signal for algorithmic distribution"
          breakdown={kpis.breakdownSaveRate}
        />
        <KPICard
          title="Engagement Score"
          value={
            kpis.avgEngScore !== undefined ? kpis.avgEngScore.toFixed(1) : "—"
          }
          tooltip={kpis.engScoreTooltip}
        />
        <KPICard
          title="Reach Score"
          value={
            kpis.avgReachScore !== undefined
              ? kpis.avgReachScore.toFixed(1)
              : "—"
          }
          tooltip={kpis.reachScoreTooltip}
        />
      </div>

      {/* Weekly Summary */}
      <WeeklySummary summaries={weeklySummaries} />

      {/* Charts Row */}
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
        <AlertsFeed alerts={alerts} />
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
                    style={{
                      background: config.colorBg,
                      color: config.color,
                    }}
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
