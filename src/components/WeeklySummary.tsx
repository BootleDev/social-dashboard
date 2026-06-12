"use client";

import { useState } from "react";
import DOMPurify from "dompurify";
import { str, num } from "@/lib/utils";
import type { AirtableRecord } from "@/lib/utils";

interface WeeklySummaryProps {
  summaries: AirtableRecord[];
}

export default function WeeklySummary({ summaries }: WeeklySummaryProps) {
  // Index into `summaries` of the report currently being shown. 0 = latest
  // (summaries are pre-sorted newest-first). Older reports are reachable via
  // the prev/next chevrons and the period dropdown.
  const [selected, setSelected] = useState(0);
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

  // Clamp in case the array shrank (e.g. a tighter date filter) while a later
  // index was selected.
  const index = Math.min(selected, summaries.length - 1);
  const current = summaries[index];
  const period = str(current.fields["Period"]);
  const postsAnalysed = num(current.fields["Posts Analysed"]);
  const topPost = str(current.fields["Top Post"]);
  const platformBreakdown = str(current.fields["Platform Breakdown"]);
  const report = str(current.fields["Full Report"]);

  const hasMultiple = summaries.length > 1;

  // newer = lower index; older = higher index.
  const goNewer = () => {
    setSelected((i) => Math.max(0, Math.min(i, summaries.length - 1) - 1));
    setExpanded(false);
  };
  const goOlder = () => {
    setSelected((i) =>
      Math.min(summaries.length - 1, Math.min(i, summaries.length - 1) + 1),
    );
    setExpanded(false);
  };

  return (
    <div
      className="rounded-xl p-5"
      style={{
        background: "var(--bg-card)",
        border: "1px solid var(--border)",
      }}
    >
      <div className="flex items-center justify-between mb-3 gap-2">
        <h3
          className="text-sm font-medium"
          style={{ color: "var(--text-secondary)" }}
        >
          Weekly Report
        </h3>

        {hasMultiple ? (
          <div className="flex items-center gap-1">
            <button
              type="button"
              onClick={goNewer}
              disabled={index === 0}
              aria-label="Newer report"
              className="text-xs px-1.5 py-0.5 rounded transition-colors disabled:opacity-30 disabled:cursor-default cursor-pointer hover:bg-surface-secondary"
              style={{ color: "var(--text-secondary)" }}
            >
              {"‹"}
            </button>
            <select
              value={index}
              onChange={(e) => {
                setSelected(Number(e.target.value));
                setExpanded(false);
              }}
              aria-label="Select report period"
              className="text-[10px] px-2 py-0.5 rounded cursor-pointer outline-none"
              style={{
                background: "var(--bg-secondary)",
                color: "var(--text-secondary)",
                border: "1px solid var(--border)",
              }}
            >
              {summaries.map((s, i) => (
                <option key={s.id || i} value={i}>
                  {str(s.fields["Period"]) || `Report ${i + 1}`}
                  {i === 0 ? " (latest)" : ""}
                </option>
              ))}
            </select>
            <button
              type="button"
              onClick={goOlder}
              disabled={index === summaries.length - 1}
              aria-label="Older report"
              className="text-xs px-1.5 py-0.5 rounded transition-colors disabled:opacity-30 disabled:cursor-default cursor-pointer hover:bg-surface-secondary"
              style={{ color: "var(--text-secondary)" }}
            >
              {"›"}
            </button>
          </div>
        ) : (
          <span
            className="text-[10px] px-2 py-0.5 rounded"
            style={{
              background: "var(--bg-secondary)",
              color: "var(--text-secondary)",
            }}
          >
            {period}
          </span>
        )}
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
            className="text-xs font-medium transition-colors hover:opacity-80 cursor-pointer"
            style={{ color: "var(--brand)" }}
          >
            {expanded ? "Hide full report" : "View full report"}
          </button>
          {expanded && (
            <div
              className="report-body mt-3 p-4 rounded-lg text-xs leading-relaxed overflow-y-auto"
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

      {/* Position indicator when viewing an older report */}
      {hasMultiple && (
        <p
          className="text-[10px] mt-2"
          style={{ color: "var(--text-secondary)" }}
        >
          {index === 0
            ? `Latest of ${summaries.length} reports`
            : `Report ${index + 1} of ${summaries.length}`}
        </p>
      )}
    </div>
  );
}
