"use client";

import { useMemo } from "react";
import { Line, Bar } from "react-chartjs-2";
import "@/lib/chartSetup";
import { CHART_COLORS, defaultOptions } from "@/lib/chartSetup";
import { getPlatformConfig } from "@/lib/platforms";
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
  groupByPlatform,
  getPlatformKeys,
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

    const totalReach = sumField(dailyMetrics, "Reach");
    const prevTotalReach = sumField(prevDailyMetrics, "Reach");

    const totalImpressions = sumField(dailyMetrics, "Impressions");
    const prevTotalImpressions = sumField(prevDailyMetrics, "Impressions");

    const totalProfileViews = sumField(dailyMetrics, "Profile Views");
    const avgSaves =
      posts.length > 0 ? sumField(posts, "Saves") / posts.length : 0;

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
          fill: true,
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
      {/* KPI Row */}
      <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-8 gap-3">
        <KPICard
          title="Total Followers"
          value={formatNumber(kpis.totalFollowers)}
          change={kpis.followersChange}
          tooltip={`Combined ${platformCountLabel} followers`}
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
          value={
            kpis.totalImpressions > 0
              ? formatNumber(kpis.totalImpressions)
              : "—"
          }
          change={
            kpis.totalImpressions > 0 ? kpis.impressionsChange : undefined
          }
          tooltip="Instagram does not provide account-level impressions for accounts under ~10K followers. This is an API limitation, not a tracking issue."
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
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-4">
          {top5.map((post, i) => {
            const caption = str(post.fields["Caption"]).slice(0, 120);
            const platform = str(post.fields["Platform"]);
            const postType = str(post.fields["Post Type"]);
            const er = num(post.fields["Engagement Rate"]) * 100;
            const reach = num(post.fields["Reach"]);
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
                    <strong className="text-green-400">{er.toFixed(2)}%</strong>
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
