"use client";

import { useMemo } from "react";
import { Bar, Line } from "react-chartjs-2";
import "@/lib/chartSetup";
import { CHART_COLORS, defaultOptions } from "@/lib/chartSetup";
import KPICard from "./KPICard";
import ChartCard from "./ChartCard";
import {
  num,
  str,
  formatNumber,
  formatPercent,
  avgField,
  sumField,
  splitByPlatform,
  buildUnifiedDates,
  alignToDateArray,
} from "@/lib/utils";
import type { AirtableRecord } from "@/lib/utils";

interface PlatformCompareProps {
  posts: AirtableRecord[];
  dailyMetrics: AirtableRecord[];
}

export default function PlatformCompare({
  posts,
  dailyMetrics,
}: PlatformCompareProps) {
  const { instagram: igMetrics, facebook: fbMetrics } = useMemo(
    () => splitByPlatform(dailyMetrics),
    [dailyMetrics],
  );

  const igPosts = useMemo(
    () =>
      posts.filter(
        (p) => str(p.fields["Platform"]).toLowerCase() === "instagram",
      ),
    [posts],
  );
  const fbPosts = useMemo(
    () =>
      posts.filter(
        (p) => str(p.fields["Platform"]).toLowerCase() === "facebook",
      ),
    [posts],
  );

  // Side-by-side KPIs
  const kpis = useMemo(() => {
    const latestIG = igMetrics[0];
    const latestFB = fbMetrics[0];

    return {
      ig: {
        followers: latestIG ? num(latestIG.fields["Followers"]) : 0,
        avgER: avgField(igPosts, "Engagement Rate") * 100,
        totalReach: sumField(igMetrics, "Reach"),
        totalImpressions: sumField(igMetrics, "Impressions"),
        posts: igPosts.length,
        avgSaves:
          igPosts.length > 0 ? sumField(igPosts, "Saves") / igPosts.length : 0,
        avgShares:
          igPosts.length > 0 ? sumField(igPosts, "Shares") / igPosts.length : 0,
        profileViews: sumField(igMetrics, "Profile Views"),
        webClicks: sumField(igMetrics, "Website Clicks"),
      },
      fb: {
        followers: latestFB ? num(latestFB.fields["Followers"]) : 0,
        avgER: avgField(fbPosts, "Engagement Rate") * 100,
        totalReach: sumField(fbMetrics, "Reach"),
        totalImpressions: sumField(fbMetrics, "Impressions"),
        posts: fbPosts.length,
        avgSaves:
          fbPosts.length > 0 ? sumField(fbPosts, "Saves") / fbPosts.length : 0,
        avgShares:
          fbPosts.length > 0 ? sumField(fbPosts, "Shares") / fbPosts.length : 0,
        profileViews: sumField(fbMetrics, "Profile Views"),
        webClicks: sumField(fbMetrics, "Website Clicks"),
      },
    };
  }, [igMetrics, fbMetrics, igPosts, fbPosts]);

  // Bar comparison chart
  const comparisonData = useMemo(
    () => ({
      labels: ["Avg ER %", "Avg Saves/Post", "Avg Shares/Post"],
      datasets: [
        {
          label: "Instagram",
          data: [kpis.ig.avgER, kpis.ig.avgSaves, kpis.ig.avgShares],
          backgroundColor: CHART_COLORS.purple + "80",
          borderColor: CHART_COLORS.purple,
          borderWidth: 1,
        },
        {
          label: "Facebook",
          data: [kpis.fb.avgER, kpis.fb.avgSaves, kpis.fb.avgShares],
          backgroundColor: CHART_COLORS.blue + "80",
          borderColor: CHART_COLORS.blue,
          borderWidth: 1,
        },
      ],
    }),
    [kpis],
  );

  // Unified date array
  const allDates = useMemo(
    () => buildUnifiedDates(igMetrics, fbMetrics),
    [igMetrics, fbMetrics],
  );

  // ER trend comparison
  const erTrendData = useMemo(() => {
    const labels = allDates.map((d) => d.slice(5));

    return {
      labels,
      datasets: [
        {
          label: "Instagram ER",
          data: alignToDateArray(igMetrics, allDates, "Engagement Rate").map(
            (v) => v * 100,
          ),
          borderColor: CHART_COLORS.purple,
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

  // Reach comparison
  const reachTrendData = useMemo(() => {
    const labels = allDates.map((d) => d.slice(5));

    return {
      labels,
      datasets: [
        {
          label: "Instagram Reach",
          data: alignToDateArray(igMetrics, allDates, "Reach"),
          borderColor: CHART_COLORS.purple,
          backgroundColor: "rgba(168, 85, 247, 0.1)",
          fill: true,
          tension: 0.3,
          pointRadius: 0,
        },
        {
          label: "Facebook Reach",
          data: alignToDateArray(fbMetrics, allDates, "Reach"),
          borderColor: CHART_COLORS.blue,
          backgroundColor: "rgba(59, 130, 246, 0.1)",
          fill: true,
          tension: 0.3,
          pointRadius: 0,
        },
      ],
    };
  }, [igMetrics, fbMetrics, allDates]);

  // Post type breakdown per platform
  const postTypeComparison = useMemo(() => {
    const igTypes = new Map<string, number>();
    const fbTypes = new Map<string, number>();

    for (const p of igPosts) {
      const t = str(p.fields["Post Type"]) || "other";
      igTypes.set(t, (igTypes.get(t) ?? 0) + 1);
    }
    for (const p of fbPosts) {
      const t = str(p.fields["Post Type"]) || "other";
      fbTypes.set(t, (fbTypes.get(t) ?? 0) + 1);
    }

    const allTypes = Array.from(
      new Set([...igTypes.keys(), ...fbTypes.keys()]),
    );

    return {
      labels: allTypes,
      datasets: [
        {
          label: "Instagram",
          data: allTypes.map((t) => igTypes.get(t) ?? 0),
          backgroundColor: CHART_COLORS.purple + "80",
        },
        {
          label: "Facebook",
          data: allTypes.map((t) => fbTypes.get(t) ?? 0),
          backgroundColor: CHART_COLORS.blue + "80",
        },
      ],
    };
  }, [igPosts, fbPosts]);

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

  return (
    <div className="space-y-6">
      {/* Side-by-side KPI cards */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {/* Instagram Column */}
        <div
          className="rounded-xl p-5 space-y-3"
          style={{
            background: "var(--bg-card)",
            border: "1px solid rgba(168, 85, 247, 0.3)",
          }}
        >
          <h3
            className="text-sm font-semibold"
            style={{ color: CHART_COLORS.purple }}
          >
            Instagram
          </h3>
          <div className="grid grid-cols-3 gap-2">
            <div>
              <p
                className="text-[10px]"
                style={{ color: "var(--text-secondary)" }}
              >
                Followers
              </p>
              <p className="text-lg font-bold">
                {formatNumber(kpis.ig.followers)}
              </p>
            </div>
            <div>
              <p
                className="text-[10px]"
                style={{ color: "var(--text-secondary)" }}
              >
                Avg ER
              </p>
              <p className="text-lg font-bold">
                {formatPercent(kpis.ig.avgER)}
              </p>
            </div>
            <div>
              <p
                className="text-[10px]"
                style={{ color: "var(--text-secondary)" }}
              >
                Total Reach
              </p>
              <p className="text-lg font-bold">
                {formatNumber(kpis.ig.totalReach)}
              </p>
            </div>
            <div>
              <p
                className="text-[10px]"
                style={{ color: "var(--text-secondary)" }}
              >
                Posts
              </p>
              <p className="text-lg font-bold">{kpis.ig.posts}</p>
            </div>
            <div>
              <p
                className="text-[10px]"
                style={{ color: "var(--text-secondary)" }}
              >
                Profile Views
              </p>
              <p className="text-lg font-bold">
                {formatNumber(kpis.ig.profileViews)}
              </p>
            </div>
            <div>
              <p
                className="text-[10px]"
                style={{ color: "var(--text-secondary)" }}
              >
                Web Clicks
              </p>
              <p className="text-lg font-bold">
                {formatNumber(kpis.ig.webClicks)}
              </p>
            </div>
          </div>
        </div>

        {/* Facebook Column */}
        <div
          className="rounded-xl p-5 space-y-3"
          style={{
            background: "var(--bg-card)",
            border: "1px solid rgba(59, 130, 246, 0.3)",
          }}
        >
          <h3
            className="text-sm font-semibold"
            style={{ color: CHART_COLORS.blue }}
          >
            Facebook
          </h3>
          <div className="grid grid-cols-3 gap-2">
            <div>
              <p
                className="text-[10px]"
                style={{ color: "var(--text-secondary)" }}
              >
                Followers
              </p>
              <p className="text-lg font-bold">
                {formatNumber(kpis.fb.followers)}
              </p>
            </div>
            <div>
              <p
                className="text-[10px]"
                style={{ color: "var(--text-secondary)" }}
              >
                Avg ER
              </p>
              <p className="text-lg font-bold">
                {formatPercent(kpis.fb.avgER)}
              </p>
            </div>
            <div>
              <p
                className="text-[10px]"
                style={{ color: "var(--text-secondary)" }}
              >
                Total Reach
              </p>
              <p className="text-lg font-bold">
                {formatNumber(kpis.fb.totalReach)}
              </p>
            </div>
            <div>
              <p
                className="text-[10px]"
                style={{ color: "var(--text-secondary)" }}
              >
                Posts
              </p>
              <p className="text-lg font-bold">{kpis.fb.posts}</p>
            </div>
            <div>
              <p
                className="text-[10px]"
                style={{ color: "var(--text-secondary)" }}
              >
                Profile Views
              </p>
              <p className="text-lg font-bold">
                {formatNumber(kpis.fb.profileViews)}
              </p>
            </div>
            <div>
              <p
                className="text-[10px]"
                style={{ color: "var(--text-secondary)" }}
              >
                Web Clicks
              </p>
              <p className="text-lg font-bold">
                {formatNumber(kpis.fb.webClicks)}
              </p>
            </div>
          </div>
        </div>
      </div>

      {/* Trend Charts */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <ChartCard title="Engagement Rate Comparison">
          <Line data={erTrendData} options={defaultOptions} />
        </ChartCard>
        <ChartCard title="Reach Comparison">
          <Line data={reachTrendData} options={defaultOptions} />
        </ChartCard>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <ChartCard title="Performance Comparison">
          <Bar data={comparisonData} options={defaultOptions} />
        </ChartCard>
        <ChartCard title="Content Mix by Platform">
          <Bar data={postTypeComparison} options={defaultOptions} />
        </ChartCard>
      </div>
    </div>
  );
}
