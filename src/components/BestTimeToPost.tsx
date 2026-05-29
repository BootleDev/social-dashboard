"use client";

import { useMemo, useState } from "react";
import {
  num,
  str,
  dayOfWeekLocal,
  hourOfDayLocal,
  formatLocalDate,
} from "@/lib/utils";
import { toPost } from "@/lib/types";
import {
  saveRate,
  shareRate,
  viewThroughRate,
} from "@/lib/derivedMetrics";
import ChartCard from "./ChartCard";
import StatsPanel from "./StatsPanel";
import PostDrilldownPanel from "./PostDrilldownPanel";
import { describe } from "@/lib/stats";
import type { AirtableRecord } from "@/lib/utils";

interface BestTimeToPostProps {
  posts: AirtableRecord[];
  timezone: string;
}

interface MetricOption {
  label: string;
  short: string;
  getMetric: (r: AirtableRecord) => number | undefined;
  format: (v: number) => string;
}

const METRICS: MetricOption[] = [
  {
    label: "Engagement Rate",
    short: "ER",
    getMetric: (r) => {
      const v = num(r.fields["Engagement Rate"]);
      return v > 0 ? v * 100 : undefined;
    },
    format: (v) => `${v.toFixed(2)}%`,
  },
  {
    label: "Reach",
    short: "Reach",
    getMetric: (r) => {
      const v = num(r.fields["Reach"]);
      return v > 0 ? v : undefined;
    },
    format: (v) => v.toFixed(0),
  },
  {
    label: "Save Rate",
    short: "Save%",
    getMetric: (r) => {
      const p = toPost(r);
      const v = saveRate(p);
      return v !== undefined ? v * 100 : undefined;
    },
    format: (v) => `${v.toFixed(2)}%`,
  },
  {
    label: "Share Rate",
    short: "Share%",
    getMetric: (r) => {
      const p = toPost(r);
      const v = shareRate(p);
      return v !== undefined ? v * 100 : undefined;
    },
    format: (v) => `${v.toFixed(2)}%`,
  },
  {
    label: "View-Through Rate",
    short: "VTR",
    getMetric: (r) => {
      const p = toPost(r);
      const v = viewThroughRate(p);
      return v !== undefined ? v * 100 : undefined;
    },
    format: (v) => `${v.toFixed(1)}%`,
  },
];

const DAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"] as const;
const HOURS = Array.from({ length: 24 }, (_, i) => i);

interface CellState {
  posts: AirtableRecord[];
  avg: number | null;
}

function buildGrid(
  posts: AirtableRecord[],
  timezone: string,
  metric: MetricOption,
): CellState[][] {
  // grid[day][hour] = { posts, avg }
  const grid: CellState[][] = DAYS.map(() =>
    HOURS.map(() => ({ posts: [], avg: null })),
  );

  for (const r of posts) {
    const iso = str(r.fields["Published At"]);
    if (!iso) continue;
    const dayLabel = dayOfWeekLocal(iso, timezone);
    const dayIdx = DAYS.indexOf(dayLabel as (typeof DAYS)[number]);
    if (dayIdx < 0) continue;
    const hour = hourOfDayLocal(iso, timezone);
    if (hour < 0 || hour > 23) continue;
    grid[dayIdx][hour].posts.push(r);
  }

  for (let d = 0; d < DAYS.length; d++) {
    for (let h = 0; h < 24; h++) {
      const cell = grid[d][h];
      if (cell.posts.length === 0) continue;
      let sum = 0;
      let n = 0;
      for (const r of cell.posts) {
        const v = metric.getMetric(r);
        if (v !== undefined && Number.isFinite(v)) {
          sum += v;
          n++;
        }
      }
      cell.avg = n > 0 ? sum / n : null;
    }
  }

  return grid;
}

function maxAcross(grid: CellState[][]): number {
  let max = 0;
  for (const row of grid) {
    for (const cell of row) {
      if (cell.avg !== null && cell.avg > max) max = cell.avg;
    }
  }
  return max;
}

/** Intensity 0..1 → CSS color. Brand-blue opacity ramp (#0171E4). */
function intensityColor(intensity: number): string {
  // 0 = near-transparent, 1 = full brand blue. Opacity ramp reads on both
  // light and dark cell backgrounds without needing a per-theme branch.
  const t = Math.max(0, Math.min(1, intensity));
  // Brand blue #0171E4 = rgb(1, 113, 228)
  return `rgba(1, 113, 228, ${0.05 + t * 0.85})`;
}

export default function BestTimeToPost({
  posts,
  timezone,
}: BestTimeToPostProps) {
  const [metricIdx, setMetricIdx] = useState(0);
  // Default to ≥5 posts per slot: any "best time" claim with sample n<5 is
  // statistical noise (one viral outlier swings the avg). User can lower it
  // explicitly if they want exploratory slot scans.
  const [minN, setMinN] = useState(5);
  const [drilldown, setDrilldown] = useState<{
    posts: AirtableRecord[];
    label: string;
  } | null>(null);

  const metric = METRICS[metricIdx];

  const grid = useMemo(
    () => buildGrid(posts, timezone, metric),
    [posts, timezone, metric],
  );

  // Rank all (day, hour) slots by metric, but only ones meeting the minimum
  // sample size — otherwise a single freak post dominates the "best time" list.
  const rankedSlots = useMemo(() => {
    const slots: Array<{
      day: string;
      dayIdx: number;
      hour: number;
      avg: number;
      n: number;
      posts: AirtableRecord[];
    }> = [];
    for (let d = 0; d < DAYS.length; d++) {
      for (let h = 0; h < 24; h++) {
        const cell = grid[d][h];
        if (cell.avg === null) continue;
        if (cell.posts.length < minN) continue;
        slots.push({
          day: DAYS[d],
          dayIdx: d,
          hour: h,
          avg: cell.avg,
          n: cell.posts.length,
          posts: cell.posts,
        });
      }
    }
    slots.sort((a, b) => b.avg - a.avg);
    return slots;
  }, [grid, minN]);

  // Heatmap intensity is computed against the max of qualifying slots, so
  // sub-min-N noise doesn't peg the color scale.
  const max = useMemo(() => {
    let m = 0;
    for (const s of rankedSlots) if (s.avg > m) m = s.avg;
    return m;
  }, [rankedSlots]);

  const topSlotKey = useMemo(() => {
    if (rankedSlots.length === 0) return null;
    return `${rankedSlots[0].dayIdx}-${rankedSlots[0].hour}`;
  }, [rankedSlots]);

  const tzLabel = timezone || "browser local";
  const totalPostsCharted = useMemo(
    () =>
      grid.reduce(
        (acc, row) => acc + row.reduce((a, c) => a + c.posts.length, 0),
        0,
      ),
    [grid],
  );

  // Average across all qualifying slots — used to express each top slot's
  // performance as "+X% vs average" for an instant comparison.
  const overallAvg = useMemo(() => {
    if (rankedSlots.length === 0) return 0;
    const sum = rankedSlots.reduce((s, slot) => s + slot.avg, 0);
    return sum / rankedSlots.length;
  }, [rankedSlots]);

  const slotStats = useMemo(
    () => describe(rankedSlots.map((s) => s.avg)),
    [rankedSlots],
  );

  return (
    <ChartCard
      title="Best Time to Post"
      tooltip={`Average ${metric.label} by day-of-week × hour-of-day in your selected timezone. Click a cell to see contributing posts.`}
      height="auto"
      headerAction={
        <StatsPanel
          stats={slotStats}
          format={(v) => metric.format(v)}
          context={`Distribution of slot averages (${metric.label})`}
        />
      }
    >
      <div
        className="text-xs mb-2 px-2 py-1.5 rounded"
        style={{
          background: "var(--bg-secondary)",
          color: "var(--text-secondary)",
        }}
      >
        Times shown in <strong style={{ color: "var(--text-primary)" }}>{tzLabel}</strong>
        {" "}· change via the timezone selector in the top toolbar
      </div>

      <div className="flex items-center justify-between mb-3 flex-wrap gap-2">
        <div className="flex items-center gap-2 flex-wrap">
          <label
            className="text-xs"
            style={{ color: "var(--text-secondary)" }}
          >
            Metric
          </label>
          <select
            value={metricIdx}
            onChange={(e) => setMetricIdx(Number(e.target.value))}
            className="text-xs rounded px-2 py-1 border cursor-pointer outline-none"
            style={{
              background: "var(--bg-secondary)",
              color: "var(--text-primary)",
              borderColor: "var(--border)",
            }}
            aria-label="Select metric"
          >
            {METRICS.map((m, i) => (
              <option key={m.label} value={i}>
                {m.label}
              </option>
            ))}
          </select>
          <label
            className="text-xs ml-2"
            style={{ color: "var(--text-secondary)" }}
          >
            Min posts per slot
          </label>
          <select
            value={minN}
            onChange={(e) => setMinN(Number(e.target.value))}
            className="text-xs rounded px-2 py-1 border cursor-pointer outline-none"
            style={{
              background: "var(--bg-secondary)",
              color: "var(--text-primary)",
              borderColor: "var(--border)",
            }}
            aria-label="Minimum posts per slot"
            title="Slots with fewer posts are excluded from rankings to reduce noise"
          >
            {[1, 2, 3, 5].map((n) => (
              <option key={n} value={n}>
                ≥ {n}
              </option>
            ))}
          </select>
        </div>
        <span
          className="text-xs"
          style={{ color: "var(--text-secondary)" }}
        >
          {totalPostsCharted} posts
        </span>
      </div>

      {rankedSlots.length > 0 && (
        <div
          className="mb-3 p-3 rounded"
          style={{
            background: "var(--brand-soft)",
            border: "1px solid var(--brand)",
          }}
        >
          <div
            className="text-xs font-medium mb-2"
            style={{ color: "var(--text-primary)" }}
          >
            Top slots — {metric.label}
          </div>
          <div className="flex flex-col gap-1">
            {rankedSlots.slice(0, 5).map((s, i) => {
              const vsAvg =
                overallAvg > 0 ? ((s.avg - overallAvg) / overallAvg) * 100 : 0;
              return (
                <button
                  key={`${s.dayIdx}-${s.hour}`}
                  onClick={() =>
                    setDrilldown({
                      posts: s.posts,
                      label: `${s.day} ${s.hour.toString().padStart(2, "0")}:00 (${tzLabel})`,
                    })
                  }
                  className="text-left text-xs flex items-center justify-between hover:bg-white/5 rounded px-1.5 py-1 cursor-pointer"
                >
                  <span style={{ color: "var(--text-primary)" }}>
                    <span className="opacity-50 mr-2">#{i + 1}</span>
                    {s.day} {s.hour.toString().padStart(2, "0")}:00
                    <span
                      className="ml-2 opacity-50"
                      style={{ color: "var(--text-secondary)" }}
                    >
                      ({s.n} posts)
                    </span>
                  </span>
                  <span>
                    <span style={{ color: "var(--text-primary)" }}>
                      {metric.format(s.avg)}
                    </span>
                    {vsAvg !== 0 && (
                      <span
                        className="ml-2"
                        style={{
                          color: vsAvg > 0 ? "var(--success)" : "var(--danger)",
                        }}
                      >
                        {vsAvg > 0 ? "+" : ""}
                        {vsAvg.toFixed(0)}% vs avg
                      </span>
                    )}
                  </span>
                </button>
              );
            })}
          </div>
        </div>
      )}

      {totalPostsCharted === 0 ? (
        <div
          className="text-xs text-center py-12"
          style={{ color: "var(--text-secondary)" }}
        >
          No posts in this period.
        </div>
      ) : (
        <div className="overflow-x-auto">
          <table className="text-[10px] border-separate border-spacing-[2px]">
            <thead>
              <tr style={{ color: "var(--text-secondary)" }}>
                <th className="text-right pr-2 font-normal">&nbsp;</th>
                {HOURS.map((h) => (
                  <th
                    key={h}
                    className="text-center font-normal w-7"
                    title={`${h.toString().padStart(2, "0")}:00`}
                  >
                    {h % 3 === 0 ? h.toString().padStart(2, "0") : ""}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {DAYS.map((day, dIdx) => (
                <tr key={day}>
                  <th
                    className="text-right pr-2 font-normal"
                    style={{ color: "var(--text-secondary)" }}
                  >
                    {day}
                  </th>
                  {HOURS.map((h) => {
                    const cell = grid[dIdx][h];
                    const qualifies = cell.posts.length >= minN;
                    const intensity =
                      cell.avg === null || max === 0 || !qualifies
                        ? 0
                        : cell.avg / max;
                    const bg = intensityColor(intensity);
                    const hasPosts = cell.posts.length > 0;
                    const isTopSlot = `${dIdx}-${h}` === topSlotKey;
                    const title = hasPosts
                      ? `${day} ${h.toString().padStart(2, "0")}:00 · ${
                          cell.posts.length
                        } post${cell.posts.length === 1 ? "" : "s"} · avg ${
                          metric.label
                        }: ${cell.avg !== null ? metric.format(cell.avg) : "—"}${
                          !qualifies ? " · below min-N threshold" : ""
                        }`
                      : `${day} ${h.toString().padStart(2, "0")}:00 · no posts`;
                    return (
                      <td
                        key={h}
                        className={`w-7 h-7 text-center align-middle ${
                          hasPosts ? "cursor-pointer" : ""
                        }`}
                        style={{
                          background: bg,
                          border: isTopSlot
                            ? "2px solid var(--brand)"
                            : "1px solid var(--border)",
                          color: intensity > 0.6 ? "#fff" : "var(--text-secondary)",
                          opacity: hasPosts && !qualifies ? 0.4 : 1,
                        }}
                        title={title}
                        onClick={() => {
                          if (!hasPosts) return;
                          setDrilldown({
                            posts: cell.posts,
                            label: `${day} ${h.toString().padStart(2, "0")}:00 (${tzLabel})`,
                          });
                        }}
                      >
                        {cell.posts.length > 0 ? cell.posts.length : ""}
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
          <p
            className="text-[10px] mt-2"
            style={{ color: "var(--text-secondary)" }}
          >
            Numbers show post count per slot. Darker purple = higher avg{" "}
            {metric.label}. Amber border = top-ranked slot. Faded cells fall
            below the min-N threshold. Click any cell to see contributing posts.
          </p>
        </div>
      )}

      {drilldown && (
        <PostDrilldownPanel
          posts={drilldown.posts}
          bucketLabel={drilldown.label}
          metricLabel={metric.label}
          getMetricValue={metric.getMetric}
          formatMetric={metric.format}
          onClose={() => setDrilldown(null)}
        />
      )}
    </ChartCard>
  );
}

// Suppress an unused-import lint warning since formatLocalDate isn't directly
// used here but is exported alongside the helpers we DO use; keeps the import
// surface honest for future component work.
void formatLocalDate;
