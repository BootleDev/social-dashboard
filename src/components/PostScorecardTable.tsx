"use client";

import { useMemo, useState } from "react";
import { num, str, formatNumber, formatPercent, formatLocalDate, recordReach } from "@/lib/utils";
import { getPlatformConfig } from "@/lib/platforms";
import type { AirtableRecord } from "@/lib/utils";
import { toPost } from "@/lib/types";
import {
  saveRate,
  viewThroughRate,
  engagementScore,
  reachScore,
  type ReachNormalizers,
} from "@/lib/derivedMetrics";
import { exportToCSV } from "@/lib/csv";

type SortField =
  | "Published At"
  | "Engagement Rate"
  | "Reach"
  | "Saves"
  | "Shares"
  | "Likes"
  | "Video Views"
  | "Link Clicks"
  | "Save Rate"
  | "VTR"
  | "Engagement Score"
  | "Reach Score"
  | "Skip Rate"
  | "Reposts";

interface PostScorecardTableProps {
  posts: AirtableRecord[];
  normalizers?: ReachNormalizers;
  timezone?: string;
}

const DEFAULT_NORMALIZERS: ReachNormalizers = {
  maxVideoViews: 0,
  maxImpressions: 0,
  avgFollowers: 1,
};

export default function PostScorecardTable({
  posts,
  normalizers = DEFAULT_NORMALIZERS,
  timezone = "",
}: PostScorecardTableProps) {
  const [sortBy, setSortBy] = useState<SortField>("Engagement Rate");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("desc");

  const derivedFields: Record<string, SortField[]> = {
    computed: ["Save Rate", "VTR", "Engagement Score", "Reach Score"],
  };

  function getDerivedValue(p: AirtableRecord, field: SortField): number {
    const post = toPost(p);
    if (field === "Save Rate") return saveRate(post) ?? -1;
    if (field === "VTR") return viewThroughRate(post) ?? -1;
    if (field === "Engagement Score") return engagementScore(post) ?? -1;
    if (field === "Reach Score") return reachScore(post, normalizers) ?? -1;
    return -1;
  }

  const sortedPosts = useMemo(() => {
    const isDerived = derivedFields.computed.includes(sortBy);
    return [...posts].sort((a, b) => {
      const aVal = isDerived
        ? getDerivedValue(a, sortBy)
        : sortBy === "Published At"
          ? str(a.fields[sortBy])
          : sortBy === "Reach"
            ? recordReach(a)
            : num(a.fields[sortBy]);
      const bVal = isDerived
        ? getDerivedValue(b, sortBy)
        : sortBy === "Published At"
          ? str(b.fields[sortBy])
          : sortBy === "Reach"
            ? recordReach(b)
            : num(b.fields[sortBy]);
      if (sortDir === "desc") return aVal > bVal ? -1 : aVal < bVal ? 1 : 0;
      return aVal < bVal ? -1 : aVal > bVal ? 1 : 0;
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [posts, sortBy, sortDir, normalizers]);

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
              "Save Rate %",
              "VTR %",
              "Eng Score",
              "Reach Score",
              "Skip Rate %",
              "Reposts",
              "Saves",
              "Shares",
              "Likes",
              "Video Views",
              "Link Clicks",
              "Comments",
              "Hook Type",
              "VO Type",
              "CTA Type",
              "Visual Style",
              "Content Pillar",
            ];
            const rows = sortedPosts.map((p) => {
              const post = toPost(p);
              return [
                str(p.fields["Caption"]).replace(/\n/g, " "),
                str(p.fields["Platform"]),
                str(p.fields["Post Type"]),
                formatLocalDate(str(p.fields["Published At"]), timezone || undefined),
                String(recordReach(p)),
                (num(p.fields["Engagement Rate"]) * 100).toFixed(2),
                ((saveRate(post) ?? 0) * 100).toFixed(2),
                ((viewThroughRate(post) ?? 0) * 100).toFixed(1),
                (engagementScore(post) ?? 0).toFixed(1),
                (reachScore(post, normalizers) ?? 0).toFixed(1),
                num(p.fields["Skip Rate"]).toFixed(1),
                String(num(p.fields["Reposts"])),
                String(num(p.fields["Saves"])),
                String(num(p.fields["Shares"])),
                String(num(p.fields["Likes"])),
                String(num(p.fields["Video Views"])),
                String(num(p.fields["Link Clicks"])),
                String(num(p.fields["Comments"])),
                str(p.fields["Hook Type"]),
                str(p.fields["VO Type"]),
                str(p.fields["CTA Type"]),
                str(p.fields["Visual Style"]),
                str(p.fields["Content Pillar"]),
              ];
            });
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
                "Save Rate",
                "VTR",
                "Engagement Score",
                "Reach Score",
                "Skip Rate",
                "Reposts",
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
                "Save Rate": "Save%",
                VTR: "VTR",
                "Engagement Score": "Eng\u2191",
                "Reach Score": "Reach\u2191",
                "Skip Rate": "Skip%",
                Reposts: "Reposts",
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
                <span>
                  {formatLocalDate(str(p.fields["Published At"]), timezone || undefined)}
                </span>
                {(() => {
                  // Show a small badge if the row hasn't been refreshed in
                  // >7 days — its metrics are likely stale.
                  const snap = str(p.fields["Snapshot Date"]);
                  if (!snap) return null;
                  const snapMs = new Date(snap + "T00:00:00Z").getTime();
                  if (isNaN(snapMs)) return null;
                  const ageDays = (Date.now() - snapMs) / 86400000;
                  if (ageDays < 7) return null;
                  return (
                    <span
                      className="ml-1 text-[9px] px-1 rounded align-middle"
                      style={{
                        background: "rgba(245, 158, 11, 0.15)",
                        color: "rgb(245, 158, 11)",
                        border: "1px solid rgba(245, 158, 11, 0.3)",
                      }}
                      title={`Metrics last refreshed ${Math.round(ageDays)}d ago (${snap}). Posts older than 60d (IG/FB) or 180d (Pinterest) aren't re-fetched.`}
                    >
                      {Math.round(ageDays)}d stale
                    </span>
                  );
                })()}
              </td>
              <td className="py-2 px-2 text-right">
                {formatNumber(recordReach(p))}
              </td>
              <td className="py-2 px-2 text-right text-success font-medium">
                {formatPercent(num(p.fields["Engagement Rate"]) * 100)}
              </td>
              <td className="py-2 px-2 text-right">
                {(() => { const v = saveRate(toPost(p)); return v !== undefined ? formatPercent(v * 100, 2) : "\u2014"; })()}
              </td>
              <td className="py-2 px-2 text-right">
                {(() => { const v = viewThroughRate(toPost(p)); return v !== undefined ? formatPercent(v * 100, 1) : "\u2014"; })()}
              </td>
              <td className="py-2 px-2 text-right">
                {(() => { const v = engagementScore(toPost(p)); return v !== undefined ? v.toFixed(1) : "\u2014"; })()}
              </td>
              <td className="py-2 px-2 text-right">
                {(() => { const v = reachScore(toPost(p), normalizers); return v !== undefined ? v.toFixed(1) : "\u2014"; })()}
              </td>
              <td className="py-2 px-2 text-right">
                {(() => {
                  const v = num(p.fields["Skip Rate"]);
                  if (v <= 0) return "\u2014";
                  // Skip Rate is 0-100 (percentage). Tint red when >70% (poor hook).
                  const cls = v > 70 ? "text-danger" : v > 50 ? "text-warning" : "";
                  return <span className={cls}>{v.toFixed(1)}%</span>;
                })()}
              </td>
              <td className="py-2 px-2 text-right">
                {num(p.fields["Reposts"]) > 0 ? num(p.fields["Reposts"]) : "\u2014"}
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
