"use client";

import { useMemo } from "react";
import { Bar } from "react-chartjs-2";
import "@/lib/chartSetup";
import { CHART_COLORS, defaultOptions } from "@/lib/chartSetup";
import ChartCard from "./ChartCard";
import { num, str, formatNumber } from "@/lib/utils";
import type { AirtableRecord } from "@/lib/utils";
import { exportToCSV } from "@/lib/csv";

interface CompetitorInsightsProps {
  records: AirtableRecord[];
  loading: boolean;
  error: string;
}

export default function CompetitorInsights({
  records,
  loading,
  error,
}: CompetitorInsightsProps) {
  // Avg views by handle (brand comparison)
  const brandData = useMemo(() => {
    const groups = new Map<
      string,
      { totalViews: number; totalLikes: number; count: number }
    >();
    for (const r of records) {
      const handle = str(r.fields["Handle"]) || "unknown";
      const views = num(r.fields["Views"]);
      const likes = num(r.fields["Likes"]);
      const existing = groups.get(handle) ?? {
        totalViews: 0,
        totalLikes: 0,
        count: 0,
      };
      groups.set(handle, {
        totalViews: existing.totalViews + views,
        totalLikes: existing.totalLikes + likes,
        count: existing.count + 1,
      });
    }

    const sorted = Array.from(groups.entries())
      .map(([handle, { totalViews, totalLikes, count }]) => ({
        handle,
        avgViews: count > 0 ? totalViews / count : 0,
        avgER: totalViews > 0 ? (totalLikes / totalViews) * 100 : 0,
        count,
      }))
      .sort((a, b) => b.avgViews - a.avgViews);

    return sorted;
  }, [records]);

  const brandChartData = useMemo(
    () => ({
      labels: brandData.map((b) => `@${b.handle} (${b.count})`),
      datasets: [
        {
          label: "Avg Views",
          data: brandData.map((b) => b.avgViews),
          backgroundColor: CHART_COLORS.purple + "60",
          borderColor: CHART_COLORS.purple,
          borderWidth: 1,
        },
      ],
    }),
    [brandData],
  );

  const brandERData = useMemo(
    () => ({
      labels: brandData.map((b) => `@${b.handle}`),
      datasets: [
        {
          label: "Like-to-View %",
          data: brandData.map((b) => b.avgER),
          backgroundColor: CHART_COLORS.green + "60",
          borderColor: CHART_COLORS.green,
          borderWidth: 1,
        },
      ],
    }),
    [brandData],
  );

  // Content theme breakdown (Topic field)
  const topicData = useMemo(() => {
    const groups = new Map<string, { count: number; totalViews: number }>();
    for (const r of records) {
      const topic = str(r.fields["Topic"]) || "untagged";
      // Truncate to first 40 chars for chart labels
      const label = topic.length > 40 ? topic.slice(0, 37) + "..." : topic;
      const views = num(r.fields["Views"]);
      const existing = groups.get(label) ?? { count: 0, totalViews: 0 };
      groups.set(label, {
        count: existing.count + 1,
        totalViews: existing.totalViews + views,
      });
    }

    return Array.from(groups.entries())
      .map(([topic, { count, totalViews }]) => ({ topic, count, totalViews }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 10);
  }, [records]);

  const topicChartData = useMemo(
    () => ({
      labels: topicData.map((t) => t.topic),
      datasets: [
        {
          label: "Posts",
          data: topicData.map((t) => t.count),
          backgroundColor: CHART_COLORS.cyan + "60",
          borderColor: CHART_COLORS.cyan,
          borderWidth: 1,
        },
      ],
    }),
    [topicData],
  );

  // Platform split
  const platformSplit = useMemo(() => {
    const groups = new Map<
      string,
      { count: number; totalViews: number; totalLikes: number }
    >();
    for (const r of records) {
      const platform = str(r.fields["Platform"]) || "unknown";
      const views = num(r.fields["Views"]);
      const likes = num(r.fields["Likes"]);
      const existing = groups.get(platform) ?? {
        count: 0,
        totalViews: 0,
        totalLikes: 0,
      };
      groups.set(platform, {
        count: existing.count + 1,
        totalViews: existing.totalViews + views,
        totalLikes: existing.totalLikes + likes,
      });
    }
    return Array.from(groups.entries())
      .map(([platform, { count, totalViews, totalLikes }]) => ({
        platform,
        count,
        totalViews,
        avgViews: count > 0 ? totalViews / count : 0,
        avgER: totalViews > 0 ? (totalLikes / totalViews) * 100 : 0,
      }))
      .sort((a, b) => b.count - a.count);
  }, [records]);

  // Hook structure breakdown
  const hookData = useMemo(() => {
    const groups = new Map<string, { count: number; totalViews: number }>();
    for (const r of records) {
      const hook = str(r.fields["Hook Structure"]);
      if (!hook) continue;
      const views = num(r.fields["Views"]);
      const existing = groups.get(hook) ?? { count: 0, totalViews: 0 };
      groups.set(hook, {
        count: existing.count + 1,
        totalViews: existing.totalViews + views,
      });
    }
    return Array.from(groups.entries())
      .map(([hook, { count, totalViews }]) => ({
        hook,
        count,
        avgViews: count > 0 ? totalViews / count : 0,
      }))
      .sort((a, b) => b.avgViews - a.avgViews)
      .slice(0, 10);
  }, [records]);

  const hookChartData = useMemo(
    () => ({
      labels: hookData.map((h) => h.hook),
      datasets: [
        {
          label: "Avg Views",
          data: hookData.map((h) => h.avgViews),
          backgroundColor: CHART_COLORS.amber + "60",
          borderColor: CHART_COLORS.amber,
          borderWidth: 1,
        },
      ],
    }),
    [hookData],
  );

  // Top 20 posts table
  const top20 = useMemo(
    () =>
      [...records]
        .sort((a, b) => num(b.fields["Views"]) - num(a.fields["Views"]))
        .slice(0, 20),
    [records],
  );

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div
          className="text-sm animate-pulse"
          style={{ color: "var(--text-secondary)" }}
        >
          Loading competitor data...
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="rounded-xl p-6 border border-red-500/30 bg-red-500/10 text-red-400 text-sm">
        Error loading competitor data: {error}
      </div>
    );
  }

  if (records.length === 0) {
    return (
      <div
        className="rounded-xl p-6"
        style={{
          background: "var(--bg-card)",
          border: "1px solid var(--border)",
        }}
      >
        <p className="text-sm" style={{ color: "var(--text-secondary)" }}>
          No competitor content data available. Run the Instagram Intelligence
          Scraper workflow to populate this data.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Platform Summary Cards */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <div
          className="rounded-xl p-4"
          style={{
            background: "var(--bg-card)",
            border: "1px solid var(--border)",
          }}
        >
          <div
            className="text-xs mb-1"
            style={{ color: "var(--text-secondary)" }}
          >
            Total Posts Scraped
          </div>
          <div className="text-lg font-bold">{records.length}</div>
        </div>
        {platformSplit.map((p) => (
          <div
            key={p.platform}
            className="rounded-xl p-4"
            style={{
              background: "var(--bg-card)",
              border: "1px solid var(--border)",
            }}
          >
            <div
              className="text-xs mb-1 capitalize"
              style={{ color: "var(--text-secondary)" }}
            >
              {p.platform}
            </div>
            <div className="text-lg font-bold">{p.count} posts</div>
            <div className="text-xs" style={{ color: "var(--text-secondary)" }}>
              Avg {formatNumber(p.avgViews)} views
            </div>
          </div>
        ))}
      </div>

      {/* Top Competitor Content Table */}
      <div
        className="rounded-xl p-5 overflow-x-auto"
        style={{
          background: "var(--bg-card)",
          border: "1px solid var(--border)",
        }}
      >
        <div className="flex items-center justify-between mb-4">
          <h3
            className="text-base font-medium"
            style={{ color: "var(--text-secondary)" }}
          >
            Top Competitor Content by Views
          </h3>
          <button
            onClick={() => {
              const headers = [
                "Handle",
                "Platform",
                "Caption",
                "Views",
                "Likes",
                "Comments",
                "Shares",
                "Hook",
                "Date",
              ];
              const rows = top20.map((r) => [
                str(r.fields["Handle"]),
                str(r.fields["Platform"]),
                str(r.fields["Caption"]).replace(/\n/g, " "),
                String(num(r.fields["Views"])),
                String(num(r.fields["Likes"])),
                String(num(r.fields["Comments"])),
                String(num(r.fields["Shares"])),
                str(r.fields["Hook Structure"]),
                str(r.fields["Post Date"]).split("T")[0],
              ]);
              exportToCSV(headers, rows, "competitor-content.csv");
            }}
            className="text-xs px-2 py-1 rounded transition-colors hover:bg-white/10 cursor-pointer"
            style={{
              color: "var(--text-secondary)",
              border: "1px solid var(--border)",
            }}
          >
            Export CSV
          </button>
        </div>
        <table className="w-full text-sm">
          <thead>
            <tr style={{ color: "var(--text-secondary)" }}>
              <th scope="col" className="text-left py-2 px-2">
                Handle
              </th>
              <th scope="col" className="text-left py-2 px-2">
                Platform
              </th>
              <th scope="col" className="text-left py-2 px-2">
                Caption
              </th>
              <th scope="col" className="text-right py-2 px-2">
                Views
              </th>
              <th scope="col" className="text-right py-2 px-2">
                Likes
              </th>
              <th scope="col" className="text-right py-2 px-2">
                Comments
              </th>
              <th scope="col" className="text-right py-2 px-2">
                Shares
              </th>
              <th scope="col" className="text-left py-2 px-2">
                Hook
              </th>
              <th scope="col" className="text-left py-2 px-2">
                Date
              </th>
            </tr>
          </thead>
          <tbody>
            {top20.map((r) => (
              <tr
                key={r.id}
                className="border-t hover:bg-white/5 transition-colors"
                style={{ borderColor: "var(--border)" }}
              >
                <td className="py-2 px-2 font-medium">
                  @{str(r.fields["Handle"])}
                </td>
                <td className="py-2 px-2 capitalize">
                  {str(r.fields["Platform"])}
                </td>
                <td className="py-2 px-2 max-w-[200px] truncate">
                  {str(r.fields["Caption"]).slice(0, 60)}
                </td>
                <td className="py-2 px-2 text-right font-medium">
                  {formatNumber(num(r.fields["Views"]))}
                </td>
                <td className="py-2 px-2 text-right">
                  {formatNumber(num(r.fields["Likes"]))}
                </td>
                <td className="py-2 px-2 text-right">
                  {num(r.fields["Comments"])}
                </td>
                <td className="py-2 px-2 text-right">
                  {num(r.fields["Shares"])}
                </td>
                <td className="py-2 px-2 max-w-[120px] truncate">
                  {str(r.fields["Hook Structure"]) || "—"}
                </td>
                <td className="py-2 px-2">
                  {str(r.fields["Post Date"]).split("T")[0]}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Charts Row */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <ChartCard
          title="Avg Views by Account"
          tooltip="Average views per post for each competitor account"
        >
          <Bar
            data={brandChartData}
            options={{ ...defaultOptions, indexAxis: "y" as const }}
          />
        </ChartCard>
        <ChartCard
          title="Like-to-View Ratio by Account"
          tooltip="Higher ratio = more engaging content relative to reach"
        >
          <Bar
            data={brandERData}
            options={{ ...defaultOptions, indexAxis: "y" as const }}
          />
        </ChartCard>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <ChartCard
          title="Top Content Topics"
          tooltip="Most common AI-tagged topics across competitor content"
        >
          <Bar
            data={topicChartData}
            options={{ ...defaultOptions, indexAxis: "y" as const }}
          />
        </ChartCard>
        <ChartCard
          title="Hook Structure Performance"
          tooltip="Avg views by hook type — which openings perform best?"
        >
          <Bar
            data={hookChartData}
            options={{ ...defaultOptions, indexAxis: "y" as const }}
          />
        </ChartCard>
      </div>
    </div>
  );
}
