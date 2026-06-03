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
  sumReach,
  hasRealReach,
  hasRealImpressions,
  avgField,
  groupByPlatform,
  getPlatformKeys,
  buildUnifiedDates,
  alignToDateArray,
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
  /** Account-grain daily facts, date+platform filtered. Source for window KPIs. */
  dailyMetrics: AirtableRecord[];
  /**
   * Account facts WITHOUT date filtering (platform filter only). Used to read
   * the Instagram 30-day period figures off the latest period_aggregate row —
   * those are rolling platform totals and must never be date-gated or summed.
   */
  periodFacts?: AirtableRecord[];
  alerts: AirtableRecord[];
  weeklySummaries: AirtableRecord[];
  prevPosts: AirtableRecord[];
  prevDailyMetrics: AirtableRecord[];
  /** Open the post drilldown for a post-linked alert. */
  onSelectPost: (post: AirtableRecord) => void;
}

export default function Overview({
  posts,
  dailyMetrics,
  periodFacts = [],
  alerts,
  weeklySummaries,
  prevPosts,
  prevDailyMetrics,
  onSelectPost,
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

    // Reach and Impressions are summed PER METRIC from only the rows that carry
    // a real measurement for that specific metric. An Instagram row is real for
    // Reach but absent for Impressions (and Facebook the reverse), so a coarse
    // row-level guard would let one metric's absence sum as 0. hasRealReach /
    // hasRealImpressions judge each metric independently.
    const realReachMetrics = dailyMetrics.filter(hasRealReach);
    const realImprMetrics = dailyMetrics.filter(hasRealImpressions);
    const prevRealReachMetrics = prevDailyMetrics.filter(hasRealReach);
    const prevRealImprMetrics = prevDailyMetrics.filter(hasRealImpressions);

    const totalReach = sumReach(realReachMetrics);
    const prevTotalReach = sumReach(prevRealReachMetrics);

    const totalImpressions = sumField(realImprMetrics, "Impressions");
    const prevTotalImpressions = sumField(prevRealImprMetrics, "Impressions");

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

    // Per-platform pills are built ONLY from platforms that have a real
    // measurement for that specific metric. A platform the source doesn't report
    // for a metric contributes NO entry (the pill is omitted), rather than a
    // misleading 0 or a synthetic substitute. Result with current data:
    // Reach = Instagram (+ Pinterest once MARKETING-35 lands); Impressions =
    // Facebook (+ Pinterest). Facebook has no account Reach (Graph v22.0);
    // Instagram has no account Impressions (retired 2024). See the Methodology
    // page / airtable.ts source-model comment.
    const breakdownReach = platformKeys.flatMap((k) => {
      const m = (platformMap.get(k) ?? []).filter(hasRealReach);
      if (m.length === 0) return [];
      return [{ platform: k, value: formatNumber(sumReach(m)) }];
    });

    const breakdownImpressions = platformKeys.flatMap((k) => {
      const m = (platformMap.get(k) ?? []).filter(hasRealImpressions);
      if (m.length === 0) return [];
      return [{ platform: k, value: formatNumber(sumField(m, "Impressions")) }];
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

  // Instagram 30-day period figures. These are rolling platform totals that
  // Instagram reports on the latest snapshot (Period Source = period_aggregate),
  // NOT a sum of the days in the selected range — so they are read off the
  // newest period row from the UN-date-filtered facts and never summed or
  // date-gated. Only columns that are actually populated render (Views is
  // currently absent upstream — see Methodology / WEBDEV-146 Part D).
  const igPeriodTiles = useMemo(() => {
    const igRows = periodFacts
      .filter(
        (r) => str(r.fields["Platform"]).toLowerCase().trim() === "instagram",
      )
      .filter(
        (r) =>
          str(r.fields["Period Source"]).trim() === "period_aggregate",
      );
    if (igRows.length === 0) return [];
    // Newest period row wins (facts are sorted newest-first, but sort defensively
    // by Date so we don't depend on upstream ordering).
    const latest = [...igRows].sort((a, b) =>
      str(b.fields["Date"]).localeCompare(str(a.fields["Date"])),
    )[0];

    const cols: { field: string; label: string }[] = [
      { field: "Profile Views (30d)", label: "Profile Views" },
      { field: "Accounts Engaged (30d)", label: "Accounts Engaged" },
      { field: "Interactions (30d)", label: "Interactions" },
      { field: "Profile Links Taps (30d)", label: "Link Taps" },
    ];
    return cols.flatMap(({ field, label }) => {
      const raw = latest.fields[field];
      // Omit a tile whose column is empty/absent rather than show a fake 0.
      if (raw === null || raw === undefined || raw === "") return [];
      return [{ label, value: formatNumber(num(raw)) }];
    });
  }, [periodFacts]);

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
          // Nullable: a day with no Followers value is a gap, not a dip to 0.
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
          // Nullable: days with no ER stay gaps; null * 100 would be 0, so guard.
          data: alignToDateArrayNullable(metrics, allDates, "Engagement Rate").map(
            (v) => (v === null ? null : v * 100),
          ),
          borderColor: config.color,
          tension: 0.3,
          pointRadius: 0,
          spanGaps: false,
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
          tooltip={`${glossaryFor("Reach")} Account reach is summed per platform from real-measurement days. Instagram reports it; Facebook's API (v22.0) does not, so Facebook has no reach pill here — an honest absence, not a gap. Pinterest account reach arrives with the Pinterest daily-facts work. See the Methodology page.`}
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
          tooltip="Account-level impressions, summed per platform only from days that carry a real measurement. Facebook reports account impressions; Instagram does not (it retired account impressions in 2024, now 'views'), so Instagram has no impressions pill here — that absence is correct, not a tracking gap. Shows — when no platform reports impressions in the window. See the Methodology page for how each platform's numbers are sourced."
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
          tooltip={glossaryFor("Engagement Rate")}
          breakdown={kpis.breakdownER}
        />
        <KPICard
          title="Avg Save Rate"
          value={
            kpis.avgSaveRate !== undefined
              ? formatPercent(kpis.avgSaveRate * 100)
              : "—"
          }
          tooltip={glossaryFor("Save Rate")}
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

      {/* Instagram 30-day period figures. Rolling platform totals reported by
          Instagram, NOT a sum of the selected range — shown separately and never
          summed/date-filtered. Renders only when populated. */}
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
                  {t.label}{" "}
                  <span style={{ opacity: 0.7 }}>(30d)</span>
                </span>
                <span className="text-xl font-bold">{t.value}</span>
              </div>
            ))}
          </div>
        </div>
      )}

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
        <AlertsFeed
          alerts={alerts}
          posts={posts}
          onSelectPost={onSelectPost}
        />
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
