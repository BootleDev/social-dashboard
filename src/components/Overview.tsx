"use client";

import { useMemo } from "react";
import { Line, Bar } from "react-chartjs-2";
import "@/lib/chartSetup";
import { CHART_COLORS, defaultOptions } from "@/lib/chartSetup";
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
  avgField,
  splitByPlatform,
  buildUnifiedDates,
  alignToDateArray,
} from "@/lib/utils";
import type { AirtableRecord } from "@/lib/utils";

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
  const { instagram: igMetrics, facebook: fbMetrics } = useMemo(
    () => splitByPlatform(dailyMetrics),
    [dailyMetrics],
  );

  // KPI calculations with proper period comparison
  const kpis = useMemo(() => {
    const latestIG = igMetrics[0];
    const latestFB = fbMetrics[0];

    const totalFollowers =
      (latestIG ? num(latestIG.fields["Followers"]) : 0) +
      (latestFB ? num(latestFB.fields["Followers"]) : 0);

    // Previous period followers (from comparison data)
    const { instagram: prevIG, facebook: prevFB } =
      splitByPlatform(prevDailyMetrics);
    const prevFollowers =
      (prevIG[0] ? num(prevIG[0].fields["Followers"]) : 0) +
      (prevFB[0] ? num(prevFB[0].fields["Followers"]) : 0);

    const avgER = avgField(posts, "Engagement Rate") * 100;
    const prevAvgER = avgField(prevPosts, "Engagement Rate") * 100;

    const totalReach = sumField(dailyMetrics, "Reach");
    const prevTotalReach = sumField(prevDailyMetrics, "Reach");

    const totalImpressions = sumField(dailyMetrics, "Impressions");
    const prevTotalImpressions = sumField(prevDailyMetrics, "Impressions");

    const totalProfileViews = sumField(dailyMetrics, "Profile Views");
    const avgSaves =
      posts.length > 0 ? sumField(posts, "Saves") / posts.length : 0;

    // Link clicks from posts (Website Clicks from Daily Metrics is always 0)
    const totalLinkClicks = sumField(posts, "Link Clicks");
    const prevTotalLinkClicks = sumField(prevPosts, "Link Clicks");

    const totalVideoViews = sumField(posts, "Video Views");

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
      avgSaves,
      totalProfileViews,
      totalLinkClicks,
      linkClicksChange:
        prevTotalLinkClicks > 0
          ? pctChange(totalLinkClicks, prevTotalLinkClicks)
          : undefined,
      totalVideoViews,
    };
  }, [posts, dailyMetrics, igMetrics, fbMetrics, prevPosts, prevDailyMetrics]);

  // Unified date array for all charts
  const allDates = useMemo(
    () => buildUnifiedDates(igMetrics, fbMetrics),
    [igMetrics, fbMetrics],
  );

  // Follower growth chart
  const followerChartData = useMemo(() => {
    const labels = allDates.map((d) => d.slice(5));

    return {
      labels,
      datasets: [
        {
          label: "Instagram",
          data: alignToDateArray(igMetrics, allDates, "Followers"),
          borderColor: CHART_COLORS.purple,
          backgroundColor: "rgba(168, 85, 247, 0.1)",
          fill: true,
          tension: 0.3,
          pointRadius: 0,
        },
        {
          label: "Facebook",
          data: alignToDateArray(fbMetrics, allDates, "Followers"),
          borderColor: CHART_COLORS.blue,
          backgroundColor: "rgba(59, 130, 246, 0.1)",
          fill: true,
          tension: 0.3,
          pointRadius: 0,
        },
      ],
    };
  }, [igMetrics, fbMetrics, allDates]);

  // Engagement rate trend
  const erChartData = useMemo(() => {
    const labels = allDates.map((d) => d.slice(5));

    return {
      labels,
      datasets: [
        {
          label: "Instagram ER (period avg)",
          data: alignToDateArray(igMetrics, allDates, "Engagement Rate").map(
            (v) => v * 100,
          ),
          borderColor: CHART_COLORS.purple,
          borderDash: [5, 3],
          tension: 0.3,
          pointRadius: 0,
        },
        {
          label: "Facebook ER",
          data: alignToDateArray(fbMetrics, allDates, "Engagement Rate").map(
            (v) => v * 100,
          ),
          borderColor: CHART_COLORS.blue,
          tension: 0.3,
          pointRadius: 0,
        },
      ],
    };
  }, [igMetrics, fbMetrics, allDates]);

  // Posts per week bar chart
  const postsPerWeekData = useMemo(() => {
    const weekCounts = new Map<string, number>();
    for (const p of posts) {
      const dateStr = str(p.fields["Published At"]);
      if (!dateStr) continue;
      const d = new Date(dateStr);
      const weekStart = new Date(d);
      weekStart.setUTCDate(d.getUTCDate() - d.getUTCDay());
      const key = weekStart.toISOString().split("T")[0];
      weekCounts.set(key, (weekCounts.get(key) ?? 0) + 1);
    }

    const sorted = Array.from(weekCounts.entries()).sort((a, b) =>
      a[0].localeCompare(b[0]),
    );

    return {
      labels: sorted.map(([w]) => w.slice(5)),
      datasets: [
        {
          label: "Posts",
          data: sorted.map(([, c]) => c),
          backgroundColor: CHART_COLORS.purple + "60",
          borderColor: CHART_COLORS.purple,
          borderWidth: 1,
        },
      ],
    };
  }, [posts]);

  // Top 5 posts by ER
  const top5 = useMemo(() => topPosts(posts, "Engagement Rate", 5), [posts]);

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
      {/* KPI Row */}
      <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-8 gap-3">
        <KPICard
          title="Total Followers"
          value={formatNumber(kpis.totalFollowers)}
          change={kpis.followersChange}
          tooltip="Combined IG + FB followers"
        />
        <KPICard
          title="Avg Engagement Rate"
          value={formatPercent(kpis.avgER)}
          change={kpis.erChange}
          tooltip="Average across all posts in range"
        />
        <KPICard
          title="Total Reach"
          value={formatNumber(kpis.totalReach)}
          change={kpis.reachChange}
        />
        <KPICard
          title="Impressions"
          value={formatNumber(kpis.totalImpressions)}
          change={kpis.impressionsChange}
        />
        <KPICard title="Posts Published" value={String(kpis.postsPublished)} />
        <KPICard
          title="Avg Saves/Post"
          value={kpis.avgSaves.toFixed(1)}
          tooltip="Average saves per post"
        />
        <KPICard
          title="Profile Views"
          value={formatNumber(kpis.totalProfileViews)}
        />
        <KPICard
          title="Link Clicks"
          value={formatNumber(kpis.totalLinkClicks)}
          change={kpis.linkClicksChange}
          tooltip="From post-level click data"
        />
      </div>

      {/* Weekly Summary */}
      <WeeklySummary summaries={weeklySummaries} />

      {/* Charts Row */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <ChartCard title="Follower Growth">
          <Line data={followerChartData} options={defaultOptions} />
        </ChartCard>
        <ChartCard title="Engagement Rate Trend (%)">
          <Line data={erChartData} options={defaultOptions} />
        </ChartCard>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <ChartCard title="Posts Per Week">
          <Bar data={postsPerWeekData} options={defaultOptions} />
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
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-3">
          {top5.map((post, i) => {
            const caption = str(post.fields["Caption"]).slice(0, 80);
            const platform = str(post.fields["Platform"]);
            const postType = str(post.fields["Post Type"]);
            const er = num(post.fields["Engagement Rate"]) * 100;
            const reach = num(post.fields["Reach"]);
            const likes = num(post.fields["Likes"]);
            const saves = num(post.fields["Saves"]);

            return (
              <div
                key={post.id || i}
                className="rounded-lg p-3 space-y-2"
                style={{
                  background: "var(--bg-secondary)",
                  border: "1px solid var(--border)",
                }}
              >
                <div className="flex items-center justify-between">
                  <span
                    className="text-[9px] px-1.5 py-0.5 rounded font-semibold capitalize"
                    style={{
                      background:
                        platform === "instagram"
                          ? "rgba(168, 85, 247, 0.15)"
                          : "rgba(59, 130, 246, 0.15)",
                      color: platform === "instagram" ? "#a855f7" : "#3b82f6",
                    }}
                  >
                    {platform}
                  </span>
                  <span
                    className="text-[10px] capitalize"
                    style={{ color: "var(--text-secondary)" }}
                  >
                    {postType}
                  </span>
                </div>
                <p
                  className="text-xs leading-relaxed"
                  style={{ color: "var(--text-primary)" }}
                >
                  {caption}
                  {caption.length >= 80 ? "..." : ""}
                </p>
                <div
                  className="grid grid-cols-2 gap-1 text-[10px]"
                  style={{ color: "var(--text-secondary)" }}
                >
                  <span>
                    ER:{" "}
                    <strong className="text-green-400">{er.toFixed(2)}%</strong>
                  </span>
                  <span>Reach: {formatNumber(reach)}</span>
                  <span>Likes: {formatNumber(likes)}</span>
                  <span>Saves: {formatNumber(saves)}</span>
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
