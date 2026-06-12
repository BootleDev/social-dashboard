"use client";

import type { ReactNode } from "react";
import InfoTooltip from "./InfoTooltip";

interface ChartCardProps {
  title: string;
  children: ReactNode;
  height?: string;
  tooltip?: string;
  /**
   * Optional content placed at the right side of the chart title row —
   * typically a `<StatsPanel />` button. Kept compact (icon-size) so the
   * title stays the visual anchor.
   */
  headerAction?: ReactNode;
}

export default function ChartCard({
  title,
  children,
  height = "300px",
  tooltip,
  headerAction,
}: ChartCardProps) {
  return (
    <div
      className="rounded-xl p-5"
      style={{
        background: "var(--bg-card)",
        border: "1px solid var(--border)",
      }}
    >
      <div className="flex items-center justify-between mb-4 gap-2">
        <h3
          className="text-base font-medium flex items-center gap-1"
          style={{ color: "var(--text-secondary)" }}
        >
          {title}
          {tooltip && <InfoTooltip text={tooltip} label={`About ${title}`} />}
        </h3>
        {headerAction}
      </div>
      <div style={{ height }}>{children}</div>
    </div>
  );
}
