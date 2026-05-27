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
  type ReachNormalizers,
} from "@/lib/derivedMetrics";
import ChartCard from "./ChartCard";
import PostDrilldownPanel from "./PostDrilldownPanel";
import type { AirtableRecord } from "@/lib/utils";

interface BestTimeToPostProps {
  posts: AirtableRecord[];
  timezone: string;
  normalizers?: ReachNormalizers;
}

const DEFAULT_NORMALIZERS: ReachNormalizers = {
  maxVideoViews: 0,
  maxImpressions: 0,
  avgFollowers: 1,
};

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

/** Intensity 0..1 → CSS color. Uses purple scale matching the dashboard. */
function intensityColor(intensity: number): string {
  // 0 = transparent, 1 = full purple.
  // Clamp.
  const t = Math.max(0, Math.min(1, intensity));
  // Use rgba purple #a855f7
  return `rgba(168, 85, 247, ${0.05 + t * 0.85})`;
}

export default function BestTimeToPost({
  posts,
  timezone,
  normalizers = DEFAULT_NORMALIZERS,
}: BestTimeToPostProps) {
  const [metricIdx, setMetricIdx] = useState(0);
  const [drilldown, setDrilldown] = useState<{
    posts: AirtableRecord[];
    label: string;
  } | null>(null);

  const metric = METRICS[metricIdx];
  void normalizers; // reserved for derived metrics that need normalizers later

  const grid = useMemo(
    () => buildGrid(posts, timezone, metric),
    [posts, timezone, metric],
  );
  const max = useMemo(() => maxAcross(grid), [grid]);

  const tzLabel = timezone || "browser local";
  const totalPostsCharted = useMemo(
    () =>
      grid.reduce(
        (acc, row) => acc + row.reduce((a, c) => a + c.posts.length, 0),
        0,
      ),
    [grid],
  );

  return (
    <ChartCard
      title="Best Time to Post"
      tooltip={`Average ${metric.label} by day-of-week × hour-of-day in your selected timezone. Click a cell to see contributing posts.`}
      height="auto"
    >
      <div className="flex items-center justify-between mb-3 flex-wrap gap-2">
        <div className="flex items-center gap-2">
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
        </div>
        <span
          className="text-xs"
          style={{ color: "var(--text-secondary)" }}
        >
          {totalPostsCharted} posts · TZ: {tzLabel}
        </span>
      </div>

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
                    const intensity =
                      cell.avg === null || max === 0 ? 0 : cell.avg / max;
                    const bg = intensityColor(intensity);
                    const hasPosts = cell.posts.length > 0;
                    const title = hasPosts
                      ? `${day} ${h.toString().padStart(2, "0")}:00 · ${
                          cell.posts.length
                        } post${cell.posts.length === 1 ? "" : "s"} · avg ${
                          metric.label
                        }: ${cell.avg !== null ? metric.format(cell.avg) : "—"}`
                      : `${day} ${h.toString().padStart(2, "0")}:00 · no posts`;
                    return (
                      <td
                        key={h}
                        className={`w-7 h-7 text-center align-middle ${
                          hasPosts ? "cursor-pointer" : ""
                        }`}
                        style={{
                          background: bg,
                          border: "1px solid var(--border)",
                          color: intensity > 0.6 ? "#fff" : "var(--text-secondary)",
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
            {metric.label}. Click any cell to see contributing posts.
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
