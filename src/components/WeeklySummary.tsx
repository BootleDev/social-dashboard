"use client";

import { useState } from "react";
import DOMPurify from "dompurify";
import { str, num } from "@/lib/utils";
import type { AirtableRecord } from "@/lib/utils";

interface WeeklySummaryProps {
  summaries: AirtableRecord[];
}

export default function WeeklySummary({ summaries }: WeeklySummaryProps) {
  const [expanded, setExpanded] = useState(false);

  if (summaries.length === 0) {
    return (
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
          Weekly Report
        </h3>
        <p className="text-xs" style={{ color: "var(--text-secondary)" }}>
          No weekly reports yet. Reports generate automatically each Monday.
        </p>
      </div>
    );
  }

  const latest = summaries[0];
  const period = str(latest.fields["Period"]);
  const postsAnalysed = num(latest.fields["Posts Analysed"]);
  const topPost = str(latest.fields["Top Post"]);
  const platformBreakdown = str(latest.fields["Platform Breakdown"]);
  const report = str(latest.fields["Full Report"]);

  return (
    <div
      className="rounded-xl p-5"
      style={{
        background: "var(--bg-card)",
        border: "1px solid var(--border)",
      }}
    >
      <div className="flex items-center justify-between mb-3">
        <h3
          className="text-sm font-medium"
          style={{ color: "var(--text-secondary)" }}
        >
          Weekly Report
        </h3>
        <span
          className="text-[10px] px-2 py-0.5 rounded"
          style={{
            background: "var(--bg-secondary)",
            color: "var(--text-secondary)",
          }}
        >
          {period}
        </span>
      </div>

      {/* Summary stats */}
      <div className="grid grid-cols-3 gap-3 mb-3">
        <div
          className="rounded-lg p-2"
          style={{ background: "var(--bg-secondary)" }}
        >
          <div
            className="text-[10px]"
            style={{ color: "var(--text-secondary)" }}
          >
            Posts Analysed
          </div>
          <div className="text-sm font-bold">{postsAnalysed}</div>
        </div>
        <div
          className="rounded-lg p-2 col-span-2"
          style={{ background: "var(--bg-secondary)" }}
        >
          <div
            className="text-[10px]"
            style={{ color: "var(--text-secondary)" }}
          >
            Top Post
          </div>
          <div className="text-xs truncate" title={topPost}>
            {topPost || "N/A"}
          </div>
        </div>
      </div>

      {platformBreakdown && (
        <p className="text-xs mb-3" style={{ color: "var(--text-secondary)" }}>
          {platformBreakdown}
        </p>
      )}

      {/* Expandable full report */}
      {report && (
        <>
          <button
            onClick={() => setExpanded((v) => !v)}
            className="text-xs font-medium transition-colors hover:opacity-80"
            style={{ color: "var(--accent-purple)" }}
          >
            {expanded ? "Hide full report" : "View full report"}
          </button>
          {expanded && (
            <div
              className="mt-3 p-4 rounded-lg text-xs leading-relaxed overflow-y-auto"
              style={{
                background: "var(--bg-secondary)",
                maxHeight: "400px",
                color: "var(--text-primary)",
              }}
              dangerouslySetInnerHTML={{ __html: DOMPurify.sanitize(report) }}
            />
          )}
        </>
      )}

      {/* Older summaries count */}
      {summaries.length > 1 && (
        <p
          className="text-[10px] mt-2"
          style={{ color: "var(--text-secondary)" }}
        >
          {summaries.length - 1} older report{summaries.length > 2 ? "s" : ""}{" "}
          available
        </p>
      )}
    </div>
  );
}
