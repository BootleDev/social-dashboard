"use client";

import { useMemo } from "react";
import { Line, Bar } from "react-chartjs-2";
import "@/lib/chartSetup";
import { CHART_COLORS, defaultOptions } from "@/lib/chartSetup";
import KPICard from "./KPICard";
import ChartCard from "./ChartCard";
import {
  num,
  str,
  formatNumber,
  pctChange,
  splitByPlatform,
  sumField,
} from "@/lib/utils";
import type { AirtableRecord } from "@/lib/utils";

interface AudienceGrowthProps {
  posts: AirtableRecord[];
  dailyMetrics: AirtableRecord[];
}

export default function AudienceGrowth({
  posts,
  dailyMetrics,
}: AudienceGrowthProps) {
  const { instagram: igMetrics, facebook: fbMetrics } = useMemo(
    () => splitByPlatform(dailyMetrics),
    [dailyMetrics],
  );

  // Follower growth with daily change
  const followerGrowthData = useMemo(() => {
    const igSorted = [...igMetrics].reverse();
    const fbSorted = [...fbMetrics].reverse();
    const labels = igSorted.map((r) =>
      str(r.fields["Date"]).split("T")[0].slice(5),
    );

    return {
      labels,
      datasets: [
        {
          label: "Instagram Followers",
          data: igSorted.map((r) => num(r.fields["Followers"])),
          borderColor: CHART_COLORS.purple,
          backgroundColor: "rgba(168, 85, 247, 0.1)",
          fill: true,
          tension: 0.3,
          pointRadius: 0,
          yAxisID: "y",
        },
        {
          label: "Facebook Followers",
          data: fbSorted.map((r) => num(r.fields["Followers"])),
          borderColor: CHART_COLORS.blue,
          backgroundColor: "rgba(59, 130, 246, 0.1)",
          fill: true,
          tension: 0.3,
          pointRadius: 0,
          yAxisID: "y",
        },
        {
          label: "IG Daily Gain",
          data: igSorted.map((r) => num(r.fields["Followers Gained"])),
          borderColor: CHART_COLORS.green,
          backgroundColor: CHART_COLORS.green + "20",
          fill: true,
          tension: 0.3,
          pointRadius: 0,
          yAxisID: "y1",
          borderDash: [4, 2],
        },
      ],
    };
  }, [igMetrics, fbMetrics]);

  const followerGrowthOptions = {
    ...defaultOptions,
    scales: {
      ...defaultOptions.scales,
      y: {
        ...defaultOptions.scales.y,
        position: "left" as const,
        title: { display: true, text: "Followers", color: CHART_COLORS.muted },
      },
      y1: {
        position: "right" as const,
        ticks: { color: CHART_COLORS.muted, font: { size: 10 } },
        grid: { drawOnChartArea: false },
        title: { display: true, text: "Daily Gain", color: CHART_COLORS.muted },
      },
    },
  };

  // Reach trend
  const reachData = useMemo(() => {
    const igSorted = [...igMetrics].reverse();
    const fbSorted = [...fbMetrics].reverse();
    const labels = igSorted.map((r) =>
      str(r.fields["Date"]).split("T")[0].slice(5),
    );

    return {
      labels,
      datasets: [
        {
          label: "Instagram Reach",
          data: igSorted.map((r) => num(r.fields["Reach"])),
          borderColor: CHART_COLORS.purple,
          tension: 0.3,
          pointRadius: 0,
        },
        {
          label: "Facebook Reach",
          data: fbSorted.map((r) => num(r.fields["Reach"])),
          borderColor: CHART_COLORS.blue,
          tension: 0.3,
          pointRadius: 0,
        },
      ],
    };
  }, [igMetrics, fbMetrics]);

  // Profile views trend
  const profileViewsData = useMemo(() => {
    const igSorted = [...igMetrics].reverse();
    const fbSorted = [...fbMetrics].reverse();
    const labels = igSorted.map((r) =>
      str(r.fields["Date"]).split("T")[0].slice(5),
    );

    return {
      labels,
      datasets: [
        {
          label: "Instagram Profile Views",
          data: igSorted.map((r) => num(r.fields["Profile Views"])),
          backgroundColor: CHART_COLORS.purple + "60",
          borderColor: CHART_COLORS.purple,
          borderWidth: 1,
        },
        {
          label: "Facebook Page Views",
          data: fbSorted.map((r) => num(r.fields["Profile Views"])),
          backgroundColor: CHART_COLORS.blue + "60",
          borderColor: CHART_COLORS.blue,
          borderWidth: 1,
        },
      ],
    };
  }, [igMetrics, fbMetrics]);

  // KPIs
  const kpis = useMemo(() => {
    const latestIG = igMetrics[0];
    const latestFB = fbMetrics[0];
    const igFollowers = latestIG ? num(latestIG.fields["Followers"]) : 0;
    const fbFollowers = latestFB ? num(latestFB.fields["Followers"]) : 0;

    const igGrowth = sumField(igMetrics, "Followers Gained");
    const fbGrowth = sumField(fbMetrics, "Followers Gained");

    const totalReach = sumField(dailyMetrics, "Reach");
    const totalProfileViews = sumField(dailyMetrics, "Profile Views");
    const totalWebClicks = sumField(dailyMetrics, "Website Clicks");

    // Follows from posts
    const followsFromPosts = sumField(posts, "Follows From Post");

    return {
      igFollowers,
      fbFollowers,
      igGrowth,
      fbGrowth,
      totalReach,
      totalProfileViews,
      totalWebClicks,
      followsFromPosts,
    };
  }, [igMetrics, fbMetrics, dailyMetrics, posts]);

  return (
    <div className="space-y-6">
      {/* KPI Row */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <KPICard
          title="Instagram Followers"
          value={formatNumber(kpis.igFollowers)}
          subtitle={`+${kpis.igGrowth} in period`}
          platformLabel="Instagram"
        />
        <KPICard
          title="Facebook Followers"
          value={formatNumber(kpis.fbFollowers)}
          subtitle={`+${kpis.fbGrowth} in period`}
          platformLabel="Facebook"
        />
        <KPICard title="Total Reach" value={formatNumber(kpis.totalReach)} />
        <KPICard
          title="Website Clicks"
          value={formatNumber(kpis.totalWebClicks)}
          tooltip="Bio link and post link clicks"
        />
      </div>

      {/* Follower Growth Chart */}
      <ChartCard title="Follower Growth (Daily)" height="350px">
        <Line data={followerGrowthData} options={followerGrowthOptions} />
      </ChartCard>

      {/* Reach + Profile Views */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <ChartCard title="Daily Reach by Platform">
          <Line data={reachData} options={defaultOptions} />
        </ChartCard>
        <ChartCard title="Profile / Page Views">
          <Bar data={profileViewsData} options={defaultOptions} />
        </ChartCard>
      </div>

      {/* Follows from Posts */}
      {kpis.followsFromPosts > 0 && (
        <div
          className="rounded-xl p-5"
          style={{
            background: "var(--bg-card)",
            border: "1px solid var(--border)",
          }}
        >
          <h3
            className="text-sm font-medium mb-2"
            style={{ color: "var(--text-secondary)" }}
          >
            Follower Sources from Posts
          </h3>
          <p className="text-2xl font-bold">
            {formatNumber(kpis.followsFromPosts)}
          </p>
          <p
            className="text-xs mt-1"
            style={{ color: "var(--text-secondary)" }}
          >
            Total new followers attributed to individual posts in this period
          </p>
        </div>
      )}
    </div>
  );
}
