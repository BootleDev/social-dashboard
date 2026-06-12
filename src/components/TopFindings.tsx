"use client";

import { useMemo } from "react";
import { generateFindings, type Finding, type Severity } from "@/lib/findings";
import type { AirtableRecord } from "@/lib/utils";

interface TopFindingsProps {
  posts: AirtableRecord[];
}

const SEVERITY_COLOR: Record<Severity, { bg: string; border: string; tag: string }> =
  {
    positive: {
      bg: "rgba(34, 197, 94, 0.08)",
      border: "rgba(34, 197, 94, 0.35)",
      tag: "rgb(34, 197, 94)",
    },
    warning: {
      bg: "rgba(234, 179, 8, 0.08)",
      border: "rgba(234, 179, 8, 0.35)",
      tag: "rgb(234, 179, 8)",
    },
    neutral: {
      bg: "var(--bg-card)",
      border: "var(--border)",
      tag: "var(--text-secondary)",
    },
  };

const SEVERITY_LABEL: Record<Severity, string> = {
  positive: "Strength",
  warning: "Watch",
  neutral: "Note",
};

export default function TopFindings({ posts }: TopFindingsProps) {
  const findings = useMemo(() => generateFindings(posts), [posts]);

  if (findings.length === 0) return null;

  return (
    <div
      className="rounded-xl p-4"
      style={{
        background: "var(--bg-card)",
        border: "1px solid var(--border)",
      }}
    >
      <div className="flex items-center justify-between mb-3">
        <h3 className="text-sm font-semibold">Top findings</h3>
        <span className="text-[10px]" style={{ color: "var(--text-secondary)" }}>
          Auto-generated from posts in window
        </span>
      </div>
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
        {findings.map((f) => (
          <FindingCard key={f.id} finding={f} />
        ))}
      </div>
    </div>
  );
}

function FindingCard({ finding }: { finding: Finding }) {
  const c = SEVERITY_COLOR[finding.severity];
  return (
    <div
      className="rounded-lg p-3 flex flex-col gap-1.5"
      style={{ background: c.bg, border: `1px solid ${c.border}` }}
    >
      <span
        className="text-[9px] uppercase tracking-wider font-semibold"
        style={{ color: c.tag }}
      >
        {SEVERITY_LABEL[finding.severity]}
      </span>
      <p className="text-xs font-medium leading-snug">{finding.headline}</p>
      <p
        className="text-[11px] leading-relaxed"
        style={{ color: "var(--text-secondary)" }}
      >
        {finding.detail}
      </p>
    </div>
  );
}
