"use client";

import { useState, type ReactNode } from "react";
import type { DescriptiveStats } from "@/lib/stats";

interface InsightStripProps {
  /**
   * The headline sentence. Pass plain text or rich JSX (bold keywords,
   * colored deltas). Should fit one line at typical chart widths.
   */
  headline: ReactNode;
  /**
   * Confidence note rendered as a faint pill — e.g. "n=3 · low confidence".
   * Use when the underlying sample is small enough that the headline could
   * be noise rather than signal.
   */
  confidence?: string;
  /**
   * Optional descriptive stats. When present, the strip becomes clickable
   * and expands to show n / median / P25-P75 / stdev / outliers underneath.
   */
  stats?: DescriptiveStats;
  /**
   * Optional unit suffix for stats values, e.g. "%", "x", "". Stats are
   * already in user-facing scale (no auto-conversion).
   */
  statsUnit?: string;
  /**
   * Override how stat values render — useful for ER (".toFixed(2)%"),
   * counts (".toFixed(0)"), etc.
   */
  formatStat?: (v: number) => string;
  /**
   * Optional extra detail rendered in the expansion panel beneath the
   * standard stats line. Use for chart-specific context (e.g. "Outlier:
   * 'Recipe Reel #4' drives 30% of the average").
   */
  extra?: ReactNode;
}

function defaultFormat(v: number): string {
  if (Math.abs(v) >= 1000) return v.toFixed(0);
  if (Math.abs(v) >= 10) return v.toFixed(1);
  return v.toFixed(2);
}

/**
 * Standardised insight callout placed directly above a chart. Headline
 * is always visible. Stats expansion is opt-in via click — keeps the
 * default surface clean for non-analyst readers while preserving depth
 * for power users.
 */
export default function InsightStrip({
  headline,
  confidence,
  stats,
  statsUnit = "",
  formatStat = defaultFormat,
  extra,
}: InsightStripProps) {
  const [expanded, setExpanded] = useState(false);
  const expandable = stats !== undefined || extra !== undefined;

  return (
    <div
      className="rounded-lg px-4 py-2.5 mb-3 text-sm leading-snug"
      style={{
        background: "var(--bg-card-subtle, rgba(255,255,255,0.03))",
        border: "1px solid var(--border-subtle, var(--border))",
        color: "var(--text-primary)",
      }}
    >
      <button
        type="button"
        onClick={expandable ? () => setExpanded((v) => !v) : undefined}
        disabled={!expandable}
        className="w-full text-left flex items-start gap-2 disabled:cursor-default"
        aria-expanded={expandable ? expanded : undefined}
        aria-label={
          expandable
            ? expanded
              ? "Hide statistics"
              : "Show statistics"
            : undefined
        }
      >
        <span className="flex-1">
          <span>{headline}</span>
          {confidence && (
            <span
              className="ml-2 inline-block rounded px-1.5 py-0.5 text-[10px] align-middle"
              style={{
                background: "var(--bg-card)",
                color: "var(--text-secondary)",
                border: "1px solid var(--border)",
              }}
            >
              {confidence}
            </span>
          )}
        </span>
        {expandable && (
          <span
            aria-hidden
            className="text-xs select-none mt-0.5"
            style={{ color: "var(--text-secondary)" }}
          >
            {expanded ? "▾" : "▸"}
          </span>
        )}
      </button>

      {expandable && expanded && (
        <div
          className="mt-2 pt-2 text-xs"
          style={{
            borderTop: "1px solid var(--border)",
            color: "var(--text-secondary)",
          }}
        >
          {stats && (
            <div className="flex flex-wrap gap-x-4 gap-y-1">
              <span>
                <strong style={{ color: "var(--text-primary)" }}>n</strong>{" "}
                {stats.n}
              </span>
              <span>
                <strong style={{ color: "var(--text-primary)" }}>median</strong>{" "}
                {formatStat(stats.median)}
                {statsUnit}
              </span>
              <span>
                <strong style={{ color: "var(--text-primary)" }}>mean</strong>{" "}
                {formatStat(stats.mean)}
                {statsUnit}
              </span>
              <span>
                <strong style={{ color: "var(--text-primary)" }}>P25–P75</strong>{" "}
                {formatStat(stats.p25)}–{formatStat(stats.p75)}
                {statsUnit}
              </span>
              <span>
                <strong style={{ color: "var(--text-primary)" }}>stdev</strong>{" "}
                {formatStat(stats.stdev)}
                {statsUnit}
              </span>
              <span>
                <strong style={{ color: "var(--text-primary)" }}>range</strong>{" "}
                {formatStat(stats.min)}–{formatStat(stats.max)}
                {statsUnit}
              </span>
            </div>
          )}
          {extra && <div className="mt-1.5">{extra}</div>}
        </div>
      )}
    </div>
  );
}
