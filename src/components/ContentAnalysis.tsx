"use client";

import { useMemo, useState } from "react";
import { Bar, Scatter } from "react-chartjs-2";
import "@/lib/chartSetup";
import { CHART_COLORS, defaultOptions } from "@/lib/chartSetup";
import ChartCard from "./ChartCard";
import {
  num,
  str,
  formatNumber,
  formatPercent,
  avgERByPostType,
  avgERByTheme,
  postingHeatmap,
} from "@/lib/utils";
import type { AirtableRecord } from "@/lib/utils";

interface ContentAnalysisProps {
  posts: AirtableRecord[];
}

type SortField = "Published At" | "Engagement Rate" | "Reach" | "Saves" | "Shares" | "Likes";

export default function ContentAnalysis({ posts }: ContentAnalysisProps) {
  const [sortBy, setSortBy] = useState<SortField>("Engagement Rate");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("desc");

  // Sorted posts for table
  const sortedPosts = useMemo(() => {
    return [...posts].sort((a, b) => {
      const aVal = sortBy === "Published At" ? str(a.fields[sortBy]) : num(a.fields[sortBy]);
      const bVal = sortBy === "Published At" ? str(b.fields[sortBy]) : num(b.fields[sortBy]);
      if (sortDir === "desc") return aVal > bVal ? -1 : aVal < bVal ? 1 : 0;
      return aVal < bVal ? -1 : aVal > bVal ? 1 : 0;
    });
  }, [posts, sortBy, sortDir]);

  function toggleSort(field: SortField) {
    if (sortBy === field) {
      setSortDir((d) => (d === "desc" ? "asc" : "desc"));
    } else {
      setSortBy(field);
      setSortDir("desc");
    }
  }

  // Format breakdown chart
  const formatData = useMemo(() => {
    const breakdown = avgERByPostType(posts);
    return {
      labels: breakdown.map((b) => `${b.type} (${b.count})`),
      datasets: [
        {
          label: "Avg ER %",
          data: breakdown.map((b) => b.avgER * 100),
          backgroundColor: [
            CHART_COLORS.purple + "80",
            CHART_COLORS.blue + "80",
            CHART_COLORS.cyan + "80",
            CHART_COLORS.green + "80",
            CHART_COLORS.amber + "80",
            CHART_COLORS.pink + "80",
          ],
          borderWidth: 0,
        },
      ],
    };
  }, [posts]);

  // Content theme performance
  const themeData = useMemo(() => {
    const breakdown = avgERByTheme(posts).slice(0, 10);
    return {
      labels: breakdown.map((b) => `${b.theme} (${b.count})`),
      datasets: [
        {
          label: "Avg ER %",
          data: breakdown.map((b) => b.avgER * 100),
          backgroundColor: CHART_COLORS.purple + "60",
          borderColor: CHART_COLORS.purple,
          borderWidth: 1,
        },
      ],
    };
  }, [posts]);

  // Save rate vs share rate scatter
  const scatterData = useMemo(() => {
    return {
      datasets: [
        {
          label: "Posts",
          data: posts
            .filter((p) => num(p.fields["Reach"]) > 0)
            .map((p) => ({
              x: num(p.fields["Reach"]) > 0
                ? (num(p.fields["Saves"]) / num(p.fields["Reach"])) * 100
                : 0,
              y: num(p.fields["Reach"]) > 0
                ? (num(p.fields["Shares"]) / num(p.fields["Reach"])) * 100
                : 0,
            })),
          backgroundColor: CHART_COLORS.purple + "80",
          pointRadius: 5,
          pointHoverRadius: 7,
        },
      ],
    };
  }, [posts]);

  const scatterOptions = {
    ...defaultOptions,
    scales: {
      ...defaultOptions.scales,
      x: {
        ...defaultOptions.scales.x,
        title: { display: true, text: "Save Rate %", color: CHART_COLORS.muted },
      },
      y: {
        ...defaultOptions.scales.y,
        title: { display: true, text: "Share Rate %", color: CHART_COLORS.muted },
      },
    },
  };

  // Best posting times heatmap (rendered as text grid since Chart.js lacks native heatmap)
  const heatmapData = useMemo(() => postingHeatmap(posts), [posts]);
  const dayNames = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

  const maxER = useMemo(
    () => Math.max(...heatmapData.map((h) => h.avgER), 0.001),
    [heatmapData],
  );

  return (
    <div className="space-y-6">
      {/* Post Scorecard Table */}
      <div
        className="rounded-xl p-5 overflow-x-auto"
        style={{ background: "var(--bg-card)", border: "1px solid var(--border)" }}
      >
        <h3 className="text-sm font-medium mb-4" style={{ color: "var(--text-secondary)" }}>
          Post Scorecard
        </h3>
        <table className="w-full text-xs">
          <thead>
            <tr style={{ color: "var(--text-secondary)" }}>
              <th className="text-left py-2 px-2">Caption</th>
              <th className="text-left py-2 px-2">Platform</th>
              <th className="text-left py-2 px-2">Type</th>
              {(["Published At", "Reach", "Engagement Rate", "Saves", "Shares", "Likes"] as SortField[]).map((f) => (
                <th
                  key={f}
                  className="text-right py-2 px-2 cursor-pointer hover:text-white transition-colors"
                  onClick={() => toggleSort(f)}
                >
                  {f === "Engagement Rate" ? "ER" : f === "Published At" ? "Date" : f}
                  {sortBy === f && (sortDir === "desc" ? " \u2193" : " \u2191")}
                </th>
              ))}
              <th className="text-right py-2 px-2">Comments</th>
            </tr>
          </thead>
          <tbody>
            {sortedPosts.slice(0, 30).map((p, i) => (
              <tr
                key={i}
                className="border-t hover:bg-white/5 transition-colors"
                style={{ borderColor: "var(--border)" }}
              >
                <td className="py-2 px-2 max-w-[200px] truncate">
                  {str(p.fields["Caption"]).slice(0, 60)}
                </td>
                <td className="py-2 px-2 capitalize">{str(p.fields["Platform"])}</td>
                <td className="py-2 px-2 capitalize">{str(p.fields["Post Type"])}</td>
                <td className="py-2 px-2 text-right">
                  {str(p.fields["Published At"]).split("T")[0]}
                </td>
                <td className="py-2 px-2 text-right">{formatNumber(num(p.fields["Reach"]))}</td>
                <td className="py-2 px-2 text-right text-green-400 font-medium">
                  {formatPercent(num(p.fields["Engagement Rate"]) * 100)}
                </td>
                <td className="py-2 px-2 text-right">{num(p.fields["Saves"])}</td>
                <td className="py-2 px-2 text-right">{num(p.fields["Shares"])}</td>
                <td className="py-2 px-2 text-right">{num(p.fields["Likes"])}</td>
                <td className="py-2 px-2 text-right">{num(p.fields["Comments"])}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {posts.length > 30 && (
          <p className="text-xs mt-2" style={{ color: "var(--text-secondary)" }}>
            Showing 30 of {posts.length} posts
          </p>
        )}
      </div>

      {/* Charts Row */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <ChartCard title="Avg Engagement Rate by Post Type" tooltip="Higher ER = better content-market fit for that format">
          <Bar data={formatData} options={defaultOptions} />
        </ChartCard>
        <ChartCard title="Content Theme Performance" tooltip="Avg ER by AI-tagged content theme">
          <Bar data={themeData} options={{ ...defaultOptions, indexAxis: "y" as const }} />
        </ChartCard>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {/* Best Posting Times */}
        <div
          className="rounded-xl p-5"
          style={{ background: "var(--bg-card)", border: "1px solid var(--border)" }}
        >
          <h3 className="text-sm font-medium mb-4" style={{ color: "var(--text-secondary)" }}>
            Best Posting Times (Avg ER by Day/Hour)
          </h3>
          <div className="overflow-x-auto">
            <div className="grid gap-1" style={{ gridTemplateColumns: "40px repeat(24, 1fr)" }}>
              <div />
              {Array.from({ length: 24 }, (_, h) => (
                <div key={h} className="text-[8px] text-center" style={{ color: "var(--text-secondary)" }}>
                  {h}
                </div>
              ))}
              {dayNames.map((day, dayIdx) => (
                <>
                  <div key={`label-${dayIdx}`} className="text-[10px] flex items-center" style={{ color: "var(--text-secondary)" }}>
                    {day}
                  </div>
                  {Array.from({ length: 24 }, (_, h) => {
                    const cell = heatmapData.find((c) => c.day === dayIdx && c.hour === h);
                    const intensity = cell ? cell.avgER / maxER : 0;
                    return (
                      <div
                        key={`${dayIdx}-${h}`}
                        className="aspect-square rounded-sm"
                        style={{
                          background: cell
                            ? `rgba(168, 85, 247, ${0.1 + intensity * 0.8})`
                            : "var(--bg-secondary)",
                        }}
                        title={cell ? `${day} ${h}:00 — ER: ${(cell.avgER * 100).toFixed(2)}% (${cell.count} posts)` : `${day} ${h}:00 — no data`}
                      />
                    );
                  })}
                </>
              ))}
            </div>
          </div>
        </div>

        {/* Save vs Share Scatter */}
        <ChartCard title="Save Rate vs Share Rate" tooltip="Intent signals — saves = personal value, shares = social value">
          <Scatter data={scatterData} options={scatterOptions} />
        </ChartCard>
      </div>
    </div>
  );
}
