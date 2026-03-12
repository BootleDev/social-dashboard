"use client";

import type { ReactNode } from "react";

interface ChartCardProps {
  title: string;
  children: ReactNode;
  height?: string;
  tooltip?: string;
}

export default function ChartCard({
  title,
  children,
  height = "300px",
  tooltip,
}: ChartCardProps) {
  return (
    <div
      className="rounded-xl p-5"
      style={{
        background: "var(--bg-card)",
        border: "1px solid var(--border)",
      }}
    >
      <h3
        className="text-sm font-medium mb-4 flex items-center gap-1"
        style={{ color: "var(--text-secondary)" }}
      >
        {title}
        {tooltip && (
          <span
            title={tooltip}
            aria-label={tooltip}
            role="img"
            className="cursor-help opacity-50 hover:opacity-100 text-xs"
          >
            i
          </span>
        )}
      </h3>
      <div style={{ height }}>{children}</div>
    </div>
  );
}
