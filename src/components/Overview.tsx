"use client";

import { useMemo } from "react";
import { Line, Bar } from "react-chartjs-2";
import "@/lib/chartSetup";
import { CHART_COLORS, defaultOptions } from "@/lib/chartSetup";
import KPICard from "./KPICard";
import ChartCard from "./ChartCard";
import AlertsFeed from "./AlertsFeed";
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
} from "@/lib/utils";
import type { AirtableRecord } from "@/lib/utils";

interface OverviewProps {
  posts: AirtableRecord[];
  dailyMetrics: AirtableRecord[];
  alerts: AirtableRecord[];
}

export default function Overview({ posts, dailyMetrics, alerts }: OverviewProps) {
  const { instagram: igMetrics, facebook: fbMetrics } = useMemo(
    () => splitByPlatform(dailyMetrics),
    [dailyMetrics],
  );

  // KPI calculations
  const kpis = useMemo(() => {
    const latestIG = igMetrics[0];
    const latestFB = fbMetrics[0];

    const totalFollowers =
      (latestIG ? num(latestIG.fields["Followers"]) : 0) +
      (latestFB ? num(latestFB.fields["Followers"]) : 0);

    const prevIG = igMetrics.length > 7 ? igMetrics[7] : undefined;
    const prevFB = fbMetrics.length > 7 ? fbMetrics[7] : undefined;
    const prevFollowers =
      (prevIG ? num(prevIG.fields["Followers"]) : 0) +
      (prevFB ? num(prevFB.fields["Followers"]) : 0);

    const avgER = avgField(posts, "Engagement Rate") * 100;
    const totalReach = sumField(dailyMetrics, "Reach");
    const totalImpressions = sumField(dailyMetrics, "Impressions");
    const totalProfileViews = sumField(dailyMetrics, "Profile Views");
    const totalWebClicks = sumField(dailyMetrics, "Website Clicks");
    const avgSaves = posts.length > 0 ? sumField(posts, "Saves") / posts.length : 0;

    // Period comparison (first half vs second half)
    const mid = Math.floor(dailyMetrics.length / 2);
    const recentHalf = dailyMetrics.slice(0, mid);
    const olderHalf = dailyMetrics.slice(mid);

    const recentER = avgField(posts.slice(0, Math.floor(posts.length / 2)), "Engagement Rate") * 100;
    const olderER = avgField(posts.slice(Math.floor(posts.length / 2)), "Engagement Rate") * 100;

    const recentReach = sumField(recentHalf, "Reach");
    const olderReach = sumField(olderHalf, "Reach");

    return {
      totalFollowers,
      followersChange: pctChange(totalFollowers, prevFollowers),
      avgER,
      erChange: pctChange(recentER, olderER),
      totalReach,
      reachChange: pctChange(recentReach, olderReach),
      totalImpressions,
      postsPublished: posts.length,
      avgSaves,
      totalProfileViews,
      totalWebClicks,
    };
  }, [posts, dailyMetrics, igMetrics, fbMetrics]);

  // Follower growth chart
  const followerChartData = useMemo(() => {
    const igSorted = [...igMetrics].reverse();
    const fbSorted = [...fbMetrics].reverse();

    const labels = igSorted.map((r) => {
      const d = str(r.fields["Date"]).split("T")[0];
      return d.slice(5); // MM-DD
    });

    return {
      labels,
      datasets: [
        {
          label: "Instagram",
          data: igSorted.map((r) => num(r.fields["Followers"])),
          borderColor: CHART_COLORS.purple,
          backgroundColor: "rgba(168, 85, 247, 0.1)",
          fill: true,
          tension: 0.3,
          pointRadius: 0,
        },
        {
          label: "Facebook",
          data: fbSorted.map((r) => num(r.fields["Followers"])),
          borderColor: CHART_COLORS.blue,
          backgroundColor: "rgba(59, 130, 246, 0.1)",
          fill: true,
          tension: 0.3,
          pointRadius: 0,
        },
      ],
    };
  }, [igMetrics, fbMetrics]);

  // Engagement rate trend
  const erChartData = useMemo(() => {
    const igSorted = [...igMetrics].reverse();
    const fbSorted = [...fbMetrics].reverse();

    const labels = igSorted.map((r) => str(r.fields["Date"]).split("T")[0].slice(5));

    return {
      labels,
      datasets: [
        {
          label: "Instagram ER",
          data: igSorted.map((r) => num(r.fields["Engagement Rate"]) * 100),
          borderColor: CHART_COLORS.purple,
          tension: 0.3,
          pointRadius: 0,
        },
        {
          label: "Facebook ER",
          data: fbSorted.map((r) => num(r.fields["Engagement Rate"]) * 100),
          borderColor: CHART_COLORS.blue,
          tension: 0.3,
          pointRadius: 0,
        },
      ],
    };
  }, [igMetrics, fbMetrics]);

  // Posts per week bar chart
  const postsPerWeekData = useMemo(() => {
    const weekCounts = new Map<string, number>();
    for (const p of posts) {
      const dateStr = str(p.fields["Published At"]);
      if (!dateStr) continue;
      const d = new Date(dateStr);
      const weekStart = new Date(d);
      weekStart.setDate(d.getDate() - d.getDay());
      const key = weekStart.toISOString().split("T")[0];
      weekCounts.set(key, (weekCounts.get(key) ?? 0) + 1);
    }

    const sorted = Array.from(weekCounts.entries()).sort((a, b) => a[0].localeCompare(b[0]));

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
        />
        <KPICard
          title="Posts Published"
          value={String(kpis.postsPublished)}
        />
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
          title="Website Clicks"
          value={formatNumber(kpis.totalWebClicks)}
        />
      </div>

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
        style={{ background: "var(--bg-card)", border: "1px solid var(--border)" }}
      >
        <h3 className="text-sm font-medium mb-4" style={{ color: "var(--text-secondary)" }}>
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
                key={i}
                className="rounded-lg p-3 space-y-2"
                style={{ background: "var(--bg-secondary)", border: "1px solid var(--border)" }}
              >
                <div className="flex items-center justify-between">
                  <span
                    className="text-[9px] px-1.5 py-0.5 rounded font-semibold capitalize"
                    style={{
                      background: platform === "instagram" ? "rgba(168, 85, 247, 0.15)" : "rgba(59, 130, 246, 0.15)",
                      color: platform === "instagram" ? "#a855f7" : "#3b82f6",
                    }}
                  >
                    {platform}
                  </span>
                  <span className="text-[10px] capitalize" style={{ color: "var(--text-secondary)" }}>
                    {postType}
                  </span>
                </div>
                <p className="text-xs leading-relaxed" style={{ color: "var(--text-primary)" }}>
                  {caption}{caption.length >= 80 ? "..." : ""}
                </p>
                <div className="grid grid-cols-2 gap-1 text-[10px]" style={{ color: "var(--text-secondary)" }}>
                  <span>ER: <strong className="text-green-400">{er.toFixed(2)}%</strong></span>
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
