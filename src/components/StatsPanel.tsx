"use client";

import { useState } from "react";
import type { DescriptiveStats } from "@/lib/stats";

interface StatsPanelProps {
  /**
   * Descriptive stats to display. Pass undefined when not enough data —
   * the button still renders but stays disabled.
   */
  stats?: DescriptiveStats;
  /**
   * Format function for stat values — e.g. `(v) => v.toFixed(2) + "%"`.
   * Defaults to a fixed-decimal formatter that scales with magnitude.
   */
  format?: (v: number) => string;
  /**
   * Optional label appended after each stat number (e.g. " posts").
   * Use sparingly — prefer baking units into the `format` function.
   */
  unit?: string;
  /**
   * Optional title to override "Statistics" header in the panel.
   */
  title?: string;
  /**
   * Optional dimension/series name for headline context inside the panel.
   * e.g. "Engagement Rate distribution"
   */
  context?: string;
}

function defaultFormat(v: number): string {
  if (!Number.isFinite(v)) return "—";
  if (Math.abs(v) >= 1000) return v.toFixed(0);
  if (Math.abs(v) >= 10) return v.toFixed(1);
  return v.toFixed(2);
}

/**
 * Compact, toggle-able statistics container. Renders as a small "Stats"
 * button by default — click reveals a clean grid of descriptive stats
 * (n, mean, median, P25-P75, stdev, range). Designed to sit next to a
 * chart title without competing visually for attention.
 *
 * Usage:
 *   <div className="flex items-center justify-between">
 *     <h3>Chart Title</h3>
 *     <StatsPanel stats={myStats} format={fmt} />
 *   </div>
 */
export default function StatsPanel({
  stats,
  format = defaultFormat,
  unit = "",
  title = "Statistics",
  context,
}: StatsPanelProps) {
  const [open, setOpen] = useState(false);
  const disabled = !stats;

  return (
    <div className="relative inline-block">
      <button
        type="button"
        onClick={() => !disabled && setOpen((v) => !v)}
        disabled={disabled}
        aria-expanded={open}
        aria-label={open ? "Hide statistics" : "Show statistics"}
        className="text-xs px-2 py-1 rounded transition-colors disabled:opacity-40 disabled:cursor-not-allowed cursor-pointer hover:brightness-110"
        style={{
          background: open ? "var(--brand)" : "var(--bg-secondary)",
          color: open ? "#fff" : "var(--text-secondary)",
          border: "1px solid var(--border)",
        }}
      >
        {open ? "Hide stats" : "Stats"}
      </button>
      {open && stats && (
        <div
          className="absolute right-0 top-full mt-1.5 rounded-lg p-3 z-20 min-w-[260px]"
          style={{
            background: "var(--bg-card)",
            border: "1px solid var(--border)",
            boxShadow: "0 8px 24px rgba(0,0,0,0.35)",
          }}
        >
          <div className="flex items-center justify-between mb-2">
            <span
              className="text-[11px] uppercase tracking-wide font-medium"
              style={{ color: "var(--text-secondary)" }}
            >
              {title}
            </span>
            <button
              type="button"
              onClick={() => setOpen(false)}
              aria-label="Close statistics"
              className="text-[11px] cursor-pointer opacity-60 hover:opacity-100"
              style={{ color: "var(--text-secondary)" }}
            >
              ✕
            </button>
          </div>
          {context && (
            <div
              className="text-[11px] mb-2 pb-2"
              style={{
                color: "var(--text-secondary)",
                borderBottom: "1px solid var(--border)",
              }}
            >
              {context}
            </div>
          )}
          <dl
            className="grid grid-cols-2 gap-x-3 gap-y-1.5 text-xs"
            style={{ color: "var(--text-primary)" }}
          >
            <Stat label="n" value={String(stats.n)} />
            <Stat label="mean" value={format(stats.mean) + unit} />
            <Stat label="median" value={format(stats.median) + unit} />
            <Stat label="stdev" value={format(stats.stdev) + unit} />
            <Stat
              label="P25–P75"
              value={`${format(stats.p25)}–${format(stats.p75)}${unit}`}
            />
            <Stat
              label="range"
              value={`${format(stats.min)}–${format(stats.max)}${unit}`}
            />
          </dl>
        </div>
      )}
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <>
      <dt
        className="text-[11px]"
        style={{ color: "var(--text-secondary)" }}
      >
        {label}
      </dt>
      <dd className="text-xs font-medium tabular-nums text-right">{value}</dd>
    </>
  );
}
