"use client";

import { useMemo, useState } from "react";
import { num, str, formatNumber, formatPercent } from "@/lib/utils";
import { getPlatformConfig } from "@/lib/platforms";
import type { AirtableRecord } from "@/lib/utils";
import { exportToCSV } from "@/lib/csv";

type SortField =
  | "Published At"
  | "Engagement Rate"
  | "Reach"
  | "Saves"
  | "Shares"
  | "Likes"
  | "Video Views"
  | "Link Clicks";

interface PostScorecardTableProps {
  posts: AirtableRecord[];
}

export default function PostScorecardTable({ posts }: PostScorecardTableProps) {
  const [sortBy, setSortBy] = useState<SortField>("Engagement Rate");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("desc");

  const sortedPosts = useMemo(() => {
    return [...posts].sort((a, b) => {
      const aVal =
        sortBy === "Published At"
          ? str(a.fields[sortBy])
          : num(a.fields[sortBy]);
      const bVal =
        sortBy === "Published At"
          ? str(b.fields[sortBy])
          : num(b.fields[sortBy]);
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

  return (
    <div
      className="rounded-xl p-5 overflow-x-auto"
      style={{
        background: "var(--bg-card)",
        border: "1px solid var(--border)",
      }}
    >
      <div className="flex items-center justify-between mb-4">
        <h3
          className="text-sm font-medium"
          style={{ color: "var(--text-secondary)" }}
        >
          Post Scorecard
        </h3>
        <button
          onClick={() => {
            const headers = [
              "Caption",
              "Platform",
              "Type",
              "Date",
              "Reach",
              "ER %",
              "Saves",
              "Shares",
              "Likes",
              "Video Views",
              "Link Clicks",
              "Comments",
            ];
            const rows = sortedPosts.map((p) => [
              str(p.fields["Caption"]).replace(/\n/g, " "),
              str(p.fields["Platform"]),
              str(p.fields["Post Type"]),
              str(p.fields["Published At"]).split("T")[0],
              String(num(p.fields["Reach"])),
              (num(p.fields["Engagement Rate"]) * 100).toFixed(2),
              String(num(p.fields["Saves"])),
              String(num(p.fields["Shares"])),
              String(num(p.fields["Likes"])),
              String(num(p.fields["Video Views"])),
              String(num(p.fields["Link Clicks"])),
              String(num(p.fields["Comments"])),
            ]);
            exportToCSV(headers, rows, "post-scorecard.csv");
          }}
          className="text-[10px] px-2 py-1 rounded transition-colors hover:bg-white/10 cursor-pointer"
          style={{
            color: "var(--text-secondary)",
            border: "1px solid var(--border)",
          }}
        >
          Export CSV
        </button>
      </div>
      <table className="w-full text-xs">
        <thead>
          <tr style={{ color: "var(--text-secondary)" }}>
            <th scope="col" className="text-left py-2 px-2">
              Caption
            </th>
            <th scope="col" className="text-left py-2 px-2">
              Platform
            </th>
            <th scope="col" className="text-left py-2 px-2">
              Type
            </th>
            {(
              [
                "Published At",
                "Reach",
                "Engagement Rate",
                "Saves",
                "Shares",
                "Likes",
                "Video Views",
                "Link Clicks",
              ] as SortField[]
            ).map((f) => {
              const labels: Record<string, string> = {
                "Engagement Rate": "ER",
                "Published At": "Date",
                "Video Views": "Views",
                "Link Clicks": "Clicks",
              };
              return (
                <th
                  key={f}
                  scope="col"
                  className="text-right py-2 px-2 cursor-pointer hover:text-white transition-colors"
                  onClick={() => toggleSort(f)}
                >
                  {labels[f] ?? f}
                  {sortBy === f && (sortDir === "desc" ? " \u2193" : " \u2191")}
                </th>
              );
            })}
            <th scope="col" className="text-right py-2 px-2">
              Comments
            </th>
            <th scope="col" className="text-center py-2 px-2">
              Link
            </th>
          </tr>
        </thead>
        <tbody>
          {sortedPosts.slice(0, 30).map((p, i) => (
            <tr
              key={p.id || i}
              className="border-t hover:bg-white/5 transition-colors"
              style={{ borderColor: "var(--border)" }}
            >
              <td className="py-2 px-2 max-w-[200px] truncate">
                {str(p.fields["Caption"]).slice(0, 60)}
              </td>
              <td className="py-2 px-2 capitalize">
                {str(p.fields["Platform"])}
              </td>
              <td className="py-2 px-2 capitalize">
                {str(p.fields["Post Type"])}
              </td>
              <td className="py-2 px-2 text-right">
                {str(p.fields["Published At"]).split("T")[0]}
              </td>
              <td className="py-2 px-2 text-right">
                {formatNumber(num(p.fields["Reach"]))}
              </td>
              <td className="py-2 px-2 text-right text-green-400 font-medium">
                {formatPercent(num(p.fields["Engagement Rate"]) * 100)}
              </td>
              <td className="py-2 px-2 text-right">{num(p.fields["Saves"])}</td>
              <td className="py-2 px-2 text-right">
                {num(p.fields["Shares"])}
              </td>
              <td className="py-2 px-2 text-right">{num(p.fields["Likes"])}</td>
              <td className="py-2 px-2 text-right">
                {num(p.fields["Video Views"]) > 0
                  ? formatNumber(num(p.fields["Video Views"]))
                  : "—"}
              </td>
              <td className="py-2 px-2 text-right">
                {num(p.fields["Link Clicks"]) > 0
                  ? num(p.fields["Link Clicks"])
                  : "—"}
              </td>
              <td className="py-2 px-2 text-right">
                {num(p.fields["Comments"])}
              </td>
              <td className="py-2 px-2 text-center">
                {str(p.fields["Media URL"]) ? (
                  <a
                    href={str(p.fields["Media URL"])}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center justify-center transition-opacity hover:opacity-80 cursor-pointer"
                    style={{
                      color: getPlatformConfig(str(p.fields["Platform"])).color,
                    }}
                    title={`View on ${getPlatformConfig(str(p.fields["Platform"])).label}`}
                  >
                    <svg
                      width="14"
                      height="14"
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
                ) : (
                  "—"
                )}
              </td>
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
  );
}
