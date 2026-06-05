"use client";

import { useMemo, useState } from "react";
import { Bar } from "react-chartjs-2";
import type { ChartEvent, ActiveElement } from "chart.js";
import "@/lib/chartSetup";
import { useChartTheme } from "@/lib/useChartTheme";
import ChartCard from "./ChartCard";
import BestTimeToPost from "./BestTimeToPost";
import {
  str,
  avgERByDimensionStacked,
  MIN_RANK_SAMPLE,
} from "@/lib/utils";
import type { AirtableRecord } from "@/lib/utils";
import {
  planSelectionLabel,
  planSelectionEquals,
  type PlanSelection,
} from "@/lib/planSelection";

interface WhatWorkedToPlanProps {
  posts: AirtableRecord[];
  timezone: string;
  /**
   * Push the active selection to the standalone Planning tab as well. The
   * combined view filters its OWN adjacent heatmap locally, but an operator may
   * still want to carry the selection to the full Planning workspace.
   */
  onPlanFromSelection?: (sel: PlanSelection) => void;
}

/** A theme bar with its reach-weighted ER total and post count. */
interface ThemeBar {
  theme: string;
  /** Reach-weighted ER across the theme (all formats), as a percent. */
  er: number;
  count: number;
  rankable: boolean;
  /** Per-format ER (percent) within this theme, for the stacked segments. */
  segments: Array<{ format: string; er: number; count: number }>;
}

/**
 * WhatWorkedToPlan — the content-operator loop on one screen.
 *
 * Left: "What worked" — Engagement Rate by Content Theme, with Post Type as
 * stacked segments, reach-weighted, count-suffixed, sub-MIN_RANK_SAMPLE buckets
 * dimmed + asterisked + sorted last. Clicking a segment selects that
 * theme + format.
 *
 * Right: "When to post" — the existing BestTimeToPost heatmap, filtered live to
 * the selected theme + format so the operator moves from "this worked" straight
 * to "here's when to ship more of it" without changing tabs.
 *
 * The cross-tab "Plan from this →" (to the standalone Planning tab) remains
 * available via onPlanFromSelection; this view is the no-tab-switch version of
 * the same loop.
 */
export default function WhatWorkedToPlan({
  posts,
  timezone,
  onPlanFromSelection,
}: WhatWorkedToPlanProps) {
  const { colors, defaultOptions } = useChartTheme();
  const SEGMENT_COLORS = colors.series;

  // Local selection drives the adjacent heatmap with no tab switch.
  const [selection, setSelection] = useState<PlanSelection | null>(null);

  // Build theme bars with per-format segments, reach-weighted ER.
  const themeData = useMemo(() => {
    const getTheme = (p: AirtableRecord) =>
      str(p.fields["Content Theme"]) || "untagged";
    const getFormat = (p: AirtableRecord) =>
      str(p.fields["Post Type"]) || "unknown";

    const { primaries, segments, matrix } = avgERByDimensionStacked(
      posts,
      getTheme,
      getFormat,
    );

    const bars: ThemeBar[] = primaries
      .filter((p) => p.label !== "untagged" && p.label !== "")
      .map((p) => {
        const segs = segments
          .map((seg) => {
            const cell = matrix[p.label]?.[seg];
            return cell && cell.count > 0
              ? { format: seg, er: cell.avg * 100, count: cell.count }
              : null;
          })
          .filter((s): s is { format: string; er: number; count: number } => s !== null);
        // Theme-level ER is the count-weighted blend of its cells — but the
        // matrix gives per-cell reach-weighted ER directly; we surface the
        // theme total via the primary's own count and a simple cell mean for
        // the label only (the stacked segments carry the real per-format truth).
        const totalCount = p.count;
        return {
          theme: p.label,
          er:
            segs.length > 0
              ? segs.reduce((s, x) => s + x.er * x.count, 0) /
                segs.reduce((s, x) => s + x.count, 0)
              : 0,
          count: totalCount,
          rankable: totalCount >= MIN_RANK_SAMPLE,
          segments: segs,
        };
      })
      .sort((a, b) => {
        if (a.rankable !== b.rankable) return a.rankable ? -1 : 1;
        return b.er - a.er;
      })
      .slice(0, 10);

    return { bars, segments };
  }, [posts]);

  // Chart.js dataset: one dataset per format (segment), each a grouped bar so
  // segment ER values read independently (ER is a rate — stacking would imply a
  // nonsensical sum). Dimmed when the theme is sub-sample.
  const chartData = useMemo(() => {
    const { bars, segments } = themeData;
    return {
      labels: bars.map(
        (b) => `${b.theme} (${b.count})${b.rankable ? "" : " *"}`,
      ),
      datasets: segments.map((format, i) => ({
        label: format,
        data: bars.map((b) => {
          const seg = b.segments.find((s) => s.format === format);
          return seg ? seg.er : null;
        }),
        backgroundColor: bars.map((b) =>
          b.rankable
            ? SEGMENT_COLORS[i % SEGMENT_COLORS.length] + "cc"
            : SEGMENT_COLORS[i % SEGMENT_COLORS.length] + "33",
        ),
        borderWidth: 0,
      })),
    };
  }, [themeData, SEGMENT_COLORS]);

  const chartOptions = useMemo(
    () => ({
      ...defaultOptions,
      indexAxis: "y" as const,
      onClick: (_e: ChartEvent, elements: ActiveElement[]) => {
        if (elements.length === 0) return;
        const { index, datasetIndex } = elements[0];
        const bar = themeData.bars[index];
        const format = themeData.segments[datasetIndex];
        if (!bar || !format) return;
        // Only select cells that actually have posts.
        const seg = bar.segments.find((s) => s.format === format);
        if (!seg) return;
        const next: PlanSelection = { theme: bar.theme, postType: format };
        setSelection((cur) => (planSelectionEquals(cur, next) ? null : next));
      },
      onHover: (event: ChartEvent, elements: ActiveElement[]) => {
        const target = event.native?.target as HTMLElement | undefined;
        if (target) {
          target.style.cursor = elements.length > 0 ? "pointer" : "default";
        }
      },
      plugins: {
        ...defaultOptions.plugins,
        tooltip: {
          ...defaultOptions.plugins.tooltip,
          callbacks: {
            label: (ctx: {
              dataset: { label?: string };
              parsed: { x: number | null };
            }) =>
              ctx.parsed.x === null
                ? ""
                : `${ctx.dataset.label}: ${ctx.parsed.x.toFixed(2)}% ER`,
          },
        },
      },
      scales: {
        x: {
          ...defaultOptions.scales.x,
          title: { display: true, text: "Engagement Rate %", color: colors.axis },
          ticks: {
            ...defaultOptions.scales.x.ticks,
            callback: (v: string | number) => `${Number(v).toFixed(1)}%`,
          },
        },
        y: defaultOptions.scales.y,
      },
    }),
    [defaultOptions, themeData, colors],
  );

  const hasData = themeData.bars.length > 0;

  return (
    <div className="space-y-4">
      <div>
        <h2
          className="text-base font-semibold"
          style={{ color: "var(--text-primary)" }}
        >
          What worked → plan
        </h2>
        <p className="text-xs mt-1" style={{ color: "var(--text-secondary)" }}>
          The content loop on one screen. Pick a winning theme + format on the
          left; the heatmap on the right shows when that kind of content has
          performed best. Bars are reach-weighted ER; faded/asterisked bars have
          fewer than {MIN_RANK_SAMPLE} posts and aren&apos;t ranked.
        </p>
      </div>

      {/* Active selection banner with the two affordances: plan here (already
          live in the adjacent heatmap) and push to the full Planning tab. */}
      {selection && (
        <div
          className="flex items-center justify-between gap-2 px-3 py-2 rounded"
          style={{
            background: "var(--brand-soft)",
            border: "1px solid var(--brand)",
          }}
        >
          <span className="text-xs" style={{ color: "var(--text-primary)" }}>
            Selected:{" "}
            <span className="font-semibold">
              {planSelectionLabel(selection)}
            </span>{" "}
            <span style={{ color: "var(--text-secondary)" }}>
              — heatmap filtered to this theme + format
            </span>
          </span>
          <div className="flex items-center gap-2 shrink-0">
            {onPlanFromSelection && (
              <button
                type="button"
                onClick={() => onPlanFromSelection(selection)}
                className="text-xs font-medium rounded px-2.5 py-1 cursor-pointer transition-colors hover:brightness-110"
                style={{ background: "var(--brand)", color: "#fff" }}
                title="Open this selection in the full Planning workspace"
              >
                Open in Planning →
              </button>
            )}
            <button
              type="button"
              onClick={() => setSelection(null)}
              className="text-xs px-2 py-0.5 rounded cursor-pointer transition-colors hover:brightness-110"
              style={{
                background: "var(--bg-secondary)",
                color: "var(--text-secondary)",
                border: "1px solid var(--border)",
              }}
            >
              Clear
            </button>
          </div>
        </div>
      )}

      <div className="grid grid-cols-1 xl:grid-cols-2 gap-4 items-start">
        {/* LEFT — what worked */}
        <ChartCard
          title="Engagement Rate by Content Theme × Post Type"
          tooltip="Each bar is a Content Theme; segments are Post Types (formats). Bars are reach-weighted ER. Click a segment to select that theme + format and filter the heatmap. Top 10 themes; sub-sample themes are faded and sorted last."
          height="auto"
        >
          {hasData ? (
            <div
              style={{
                height: `${Math.min(
                  600,
                  Math.max(240, themeData.bars.length * 34),
                )}px`,
              }}
            >
              <Bar data={chartData} options={chartOptions} />
            </div>
          ) : (
            <div
              className="flex items-center justify-center text-xs py-12"
              style={{ color: "var(--text-secondary)" }}
            >
              No themed posts in this period. Tag posts with a Content Theme to
              unlock this view.
            </div>
          )}
        </ChartCard>

        {/* RIGHT — when to post, filtered live to the selection */}
        <BestTimeToPost
          posts={posts}
          timezone={timezone}
          planSelection={selection}
          onClearPlanSelection={() => setSelection(null)}
        />
      </div>
    </div>
  );
}
