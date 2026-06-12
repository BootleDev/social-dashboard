"use client";

import { useMemo, useState } from "react";
import {
  num,
  str,
  dayOfWeekLocal,
  hourOfDayLocal,
  dayPartOfHour,
  DAY_PARTS,
  formatLocalDate,
} from "@/lib/utils";
import { toPost } from "@/lib/types";
import { postEngagement, recordReach } from "@/lib/utils";
import { effectiveReach } from "@/lib/derivedMetrics";
import ChartCard from "./ChartCard";
import StatsPanel from "./StatsPanel";
import PostDrilldownPanel from "./PostDrilldownPanel";
import { describe } from "@/lib/stats";
import type { AirtableRecord } from "@/lib/utils";
import { glossaryFor } from "@/lib/metricGlossary";
import InfoTooltip from "./InfoTooltip";
import {
  planSelectionLabel,
  type PlanSelection,
} from "@/lib/planSelection";
import { getPlatformConfig } from "@/lib/platforms";

interface BestTimeToPostProps {
  posts: AirtableRecord[];
  timezone: string;
  /**
   * Optional carry from Insights "Plan from this →". When set, the heatmap
   * filters to posts whose Content Theme AND Post Type match the selection, so
   * the operator sees "when did THIS kind of content do best?". Null = all posts.
   */
  planSelection?: PlanSelection | null;
  /** Clear the active selection (shown on the context chip). */
  onClearPlanSelection?: () => void;
}

/** Posts whose Content Theme AND Post Type match the selection (case-folded). */
function filterToSelection(
  posts: AirtableRecord[],
  sel: PlanSelection,
): AirtableRecord[] {
  const theme = sel.theme.toLowerCase().trim();
  const type = sel.postType.toLowerCase().trim();
  return posts.filter((p) => {
    const t = str(p.fields["Content Theme"]).toLowerCase().trim();
    const pt = str(p.fields["Post Type"]).toLowerCase().trim();
    return t === theme && pt === type;
  });
}

/** Below this many matching posts, theme+format can't fill a day×hour grid. */
const MIN_SELECTION_POSTS = 4;

interface MetricOption {
  label: string;
  short: string;
  /**
   * Aggregate a bucket of posts into the metric value (or null if N/A).
   * Rate metrics are REACH-WEIGHTED — Σnumerator ÷ Σreach across the bucket,
   * not a mean of per-post rates — so one tiny-reach post can't swing a slot.
   * Returns a percentage for rates, an absolute for Reach.
   */
  aggregate: (posts: AirtableRecord[]) => number | null;
  /** Single-post value for the drilldown column (a post's own rate/value). */
  perPost: (r: AirtableRecord) => number | undefined;
  format: (v: number) => string;
}

/** Σnumerator ÷ Σ effectiveReach across a bucket, as a percent. null if no reach. */
function weightedRatePct(
  posts: AirtableRecord[],
  numerator: (p: AirtableRecord) => number,
): number | null {
  let num_ = 0;
  let reach = 0;
  for (const r of posts) {
    const er = effectiveReach(toPost(r));
    if (er > 0) {
      num_ += numerator(r);
      reach += er;
    }
  }
  return reach > 0 ? (num_ / reach) * 100 : null;
}

/** A single post's rate as a percent: numerator ÷ that post's reach. */
function perPostRatePct(
  r: AirtableRecord,
  numerator: (p: AirtableRecord) => number,
): number | undefined {
  const er = effectiveReach(toPost(r));
  return er > 0 ? (numerator(r) / er) * 100 : undefined;
}

const METRICS: MetricOption[] = [
  {
    label: "Engagement Rate",
    short: "ER",
    aggregate: (ps) => weightedRatePct(ps, (r) => postEngagement(r)),
    perPost: (r) => perPostRatePct(r, (p) => postEngagement(p)),
    format: (v) => `${v.toFixed(2)}%`,
  },
  {
    label: "Reach",
    short: "Reach",
    // Mean reach per post in the slot (absolute volume, not a rate).
    aggregate: (ps) => {
      const vals = ps.map((r) => recordReach(r)).filter((v) => v > 0);
      return vals.length > 0
        ? vals.reduce((s, v) => s + v, 0) / vals.length
        : null;
    },
    perPost: (r) => {
      const v = recordReach(r);
      return v > 0 ? v : undefined;
    },
    format: (v) => v.toFixed(0),
  },
  {
    label: "Save Rate",
    short: "Save%",
    aggregate: (ps) => weightedRatePct(ps, (r) => num(r.fields["Saves"])),
    perPost: (r) => perPostRatePct(r, (p) => num(p.fields["Saves"])),
    format: (v) => `${v.toFixed(2)}%`,
  },
  {
    label: "Share Rate",
    short: "Share%",
    aggregate: (ps) => weightedRatePct(ps, (r) => num(r.fields["Shares"])),
    perPost: (r) => perPostRatePct(r, (p) => num(p.fields["Shares"])),
    format: (v) => `${v.toFixed(2)}%`,
  },
  {
    label: "View-Through Rate",
    short: "VTR",
    aggregate: (ps) => weightedRatePct(ps, (r) => num(r.fields["Video Views"])),
    perPost: (r) => perPostRatePct(r, (p) => num(p.fields["Video Views"])),
    format: (v) => `${v.toFixed(1)}%`,
  },
];

const DAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"] as const;
const HOURS = Array.from({ length: 24 }, (_, i) => i);

/**
 * Column granularity for the heatmap. "daypart" buckets the 24 hours into 5
 * parts so a low-volume account still gets readable per-slot samples; "hour"
 * is the original 24-column grid for accounts with enough volume to fill it.
 */
type Granularity = "daypart" | "hour";

interface ColumnSpec {
  /** Column keys, left to right. */
  keys: string[];
  /** Header label for a column key (hours show every 3rd, day-parts all). */
  header: (key: string, index: number) => string;
  /** Resolve a post's column key from its local hour, or null to skip. */
  columnOf: (hour: number) => string | null;
  /** Tooltip-friendly full label for a slot. */
  slotLabel: (day: string, key: string) => string;
  /** Display width class per cell. */
  cellWidthClass: string;
}

function columnSpec(granularity: Granularity): ColumnSpec {
  if (granularity === "daypart") {
    const ranges: Record<string, string> = {
      Night: "00:00–05:59",
      Morning: "06:00–10:59",
      Midday: "11:00–13:59",
      Afternoon: "14:00–17:59",
      Evening: "18:00–23:59",
    };
    return {
      keys: [...DAY_PARTS],
      header: (key) => key,
      columnOf: (hour) => dayPartOfHour(hour),
      slotLabel: (day, key) => `${day} ${key} (${ranges[key]})`,
      cellWidthClass: "min-w-[72px]",
    };
  }
  return {
    keys: HOURS.map((h) => String(h)),
    header: (key) =>
      Number(key) % 3 === 0 ? key.padStart(2, "0") : "",
    columnOf: (hour) => (hour >= 0 && hour <= 23 ? String(hour) : null),
    slotLabel: (day, key) => `${day} ${key.padStart(2, "0")}:00`,
    cellWidthClass: "w-7",
  };
}

interface CellState {
  posts: AirtableRecord[];
  avg: number | null;
}

function buildGrid(
  posts: AirtableRecord[],
  timezone: string,
  metric: MetricOption,
  spec: ColumnSpec,
): CellState[][] {
  const colIndex = new Map(spec.keys.map((k, i) => [k, i]));
  // grid[day][column] = { posts, avg }
  const grid: CellState[][] = DAYS.map(() =>
    spec.keys.map(() => ({ posts: [], avg: null })),
  );

  for (const r of posts) {
    const iso = str(r.fields["Published At"]);
    if (!iso) continue;
    const dayLabel = dayOfWeekLocal(iso, timezone);
    const dayIdx = DAYS.indexOf(dayLabel as (typeof DAYS)[number]);
    if (dayIdx < 0) continue;
    const hour = hourOfDayLocal(iso, timezone);
    const colKey = spec.columnOf(hour);
    if (colKey === null) continue;
    const colIdx = colIndex.get(colKey);
    if (colIdx === undefined) continue;
    grid[dayIdx][colIdx].posts.push(r);
  }

  for (let d = 0; d < DAYS.length; d++) {
    for (let c = 0; c < spec.keys.length; c++) {
      const cell = grid[d][c];
      if (cell.posts.length === 0) continue;
      // Reach-weighted aggregate over the slot's posts (see MetricOption).
      const v = metric.aggregate(cell.posts);
      cell.avg = v !== null && Number.isFinite(v) ? v : null;
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
  planSelection = null,
  onClearPlanSelection,
}: BestTimeToPostProps) {
  // Apply the cross-tab selection if one is active and it yields enough posts
  // to be meaningful. If the theme+format combination is too thin to fill a
  // grid, fall back to all posts but tell the user why (so the heatmap isn't
  // silently empty after they clicked "Plan from this →").
  const { effectivePosts, selectionTooThin, matchCount } = useMemo(() => {
    if (!planSelection) {
      return { effectivePosts: posts, selectionTooThin: false, matchCount: 0 };
    }
    const matched = filterToSelection(posts, planSelection);
    if (matched.length < MIN_SELECTION_POSTS) {
      return {
        effectivePosts: posts,
        selectionTooThin: true,
        matchCount: matched.length,
      };
    }
    return {
      effectivePosts: matched,
      selectionTooThin: false,
      matchCount: matched.length,
    };
  }, [posts, planSelection]);

  const [metricIdx, setMetricIdx] = useState(0);
  // Default to day-part columns: a 24-hour grid leaves almost every slot at
  // n<2 for a low-volume account, so the heatmap reads as empty. Day-parts (5
  // columns) accumulate enough posts per slot to surface a real signal. Power
  // users with volume can switch to the full Hour grid.
  const [granularity, setGranularity] = useState<Granularity>("daypart");
  // Minimum posts per slot before a slot is eligible for the rankings/colour.
  // Day-part slots are coarser, so a sample of ≥3 is a reasonable floor;
  // hour slots default to ≥5. Reset when granularity changes (see effect).
  const [minN, setMinN] = useState(3);
  const [drilldown, setDrilldown] = useState<{
    posts: AirtableRecord[];
    label: string;
  } | null>(null);

  const metric = METRICS[metricIdx];
  const spec = useMemo(() => columnSpec(granularity), [granularity]);

  const grid = useMemo(
    () => buildGrid(effectivePosts, timezone, metric, spec),
    [effectivePosts, timezone, metric, spec],
  );

  // Rank all (day, column) slots by metric, but only ones meeting the minimum
  // sample size — otherwise a single freak post dominates the "best time" list.
  const rankedSlots = useMemo(() => {
    const slots: Array<{
      day: string;
      dayIdx: number;
      colKey: string;
      colIdx: number;
      avg: number;
      n: number;
      posts: AirtableRecord[];
    }> = [];
    for (let d = 0; d < DAYS.length; d++) {
      for (let c = 0; c < spec.keys.length; c++) {
        const cell = grid[d][c];
        if (cell.avg === null) continue;
        if (cell.posts.length < minN) continue;
        slots.push({
          day: DAYS[d],
          dayIdx: d,
          colKey: spec.keys[c],
          colIdx: c,
          avg: cell.avg,
          n: cell.posts.length,
          posts: cell.posts,
        });
      }
    }
    slots.sort((a, b) => b.avg - a.avg);
    return slots;
  }, [grid, minN, spec]);

  // Heatmap intensity is computed against the max of qualifying slots, so
  // sub-min-N noise doesn't peg the color scale.
  const max = useMemo(() => {
    let m = 0;
    for (const s of rankedSlots) if (s.avg > m) m = s.avg;
    return m;
  }, [rankedSlots]);

  const topSlotKey = useMemo(() => {
    if (rankedSlots.length === 0) return null;
    return `${rankedSlots[0].dayIdx}-${rankedSlots[0].colIdx}`;
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
      tooltip={`Average ${metric.label} by day-of-week × ${granularity === "hour" ? "hour-of-day" : "day-part"} in your selected timezone. Day-part groups the 24 hours into 5 parts so low-volume accounts get readable samples per slot; switch to Hour once you have the volume. Click a cell to see contributing posts.`}
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

      {planSelection && (
        <div
          className="mb-3 flex items-center justify-between gap-2 px-3 py-2 rounded"
          style={{
            background: "var(--brand-soft)",
            border: "1px solid var(--brand)",
          }}
        >
          <span
            className="text-xs flex items-center gap-1.5 flex-wrap"
            style={{ color: "var(--text-primary)" }}
          >
            <span className="font-medium">Planning from:</span>
            {(() => {
              const cfg = getPlatformConfig(
                str(
                  // colour the format chip by platform when the selection's posts
                  // are single-platform; otherwise leave it brand-neutral.
                  effectivePosts[0]?.fields["Platform"] ?? "",
                ),
              );
              return (
                <span
                  className="px-1.5 py-0.5 rounded font-semibold"
                  style={{ background: cfg.colorBg, color: cfg.color }}
                >
                  {planSelectionLabel(planSelection)}
                </span>
              );
            })()}
            {selectionTooThin ? (
              <span style={{ color: "var(--warning)" }}>
                only {matchCount} matching post
                {matchCount === 1 ? "" : "s"} — showing all posts instead
                (need ≥ {MIN_SELECTION_POSTS})
              </span>
            ) : (
              <span style={{ color: "var(--text-secondary)" }}>
                {matchCount} matching post{matchCount === 1 ? "" : "s"}
              </span>
            )}
          </span>
          {onClearPlanSelection && (
            <button
              type="button"
              onClick={onClearPlanSelection}
              className="text-xs px-2 py-0.5 rounded cursor-pointer shrink-0 transition-colors hover:brightness-110"
              style={{
                background: "var(--bg-secondary)",
                color: "var(--text-secondary)",
                border: "1px solid var(--border)",
              }}
            >
              Clear
            </button>
          )}
        </div>
      )}

      <div className="flex items-center justify-between mb-3 flex-wrap gap-2">
        <div className="flex items-center gap-2 flex-wrap">
          <label
            className="text-xs flex items-center gap-1"
            style={{ color: "var(--text-secondary)" }}
          >
            Metric
            {glossaryFor(metric.label) && (
              <InfoTooltip
                text={glossaryFor(metric.label)!}
                label={`What is ${metric.label}?`}
              />
            )}
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
            Granularity
          </label>
          <select
            value={granularity}
            onChange={(e) => {
              const g = e.target.value as Granularity;
              setGranularity(g);
              // Reset the per-slot floor to a sensible default for the grain.
              setMinN(g === "daypart" ? 3 : 5);
            }}
            className="text-xs rounded px-2 py-1 border cursor-pointer outline-none"
            style={{
              background: "var(--bg-secondary)",
              color: "var(--text-primary)",
              borderColor: "var(--border)",
            }}
            aria-label="Heatmap granularity"
            title="Day-part groups the 24 hours into 5 parts so low-volume accounts get readable samples per slot"
          >
            <option value="daypart">Day-part</option>
            <option value="hour">Hour</option>
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
              const slotText =
                granularity === "hour"
                  ? `${s.day} ${s.colKey.padStart(2, "0")}:00`
                  : `${s.day} ${s.colKey}`;
              return (
                <button
                  key={`${s.dayIdx}-${s.colIdx}`}
                  onClick={() =>
                    setDrilldown({
                      posts: s.posts,
                      label: `${slotText} (${tzLabel})`,
                    })
                  }
                  className="text-left text-xs flex items-center justify-between hover:bg-white/5 rounded px-1.5 py-1 cursor-pointer"
                >
                  <span style={{ color: "var(--text-primary)" }}>
                    <span className="opacity-50 mr-2">#{i + 1}</span>
                    {slotText}
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

      {totalPostsCharted > 0 && rankedSlots.length === 0 && (
        <div
          className="mb-3 p-3 rounded text-xs"
          style={{
            background: "var(--bg-secondary)",
            border: "1px solid var(--border)",
            color: "var(--text-secondary)",
          }}
        >
          Not enough posts per slot to call a best time yet. With{" "}
          {totalPostsCharted} post{totalPostsCharted === 1 ? "" : "s"} in this
          period, no {granularity === "hour" ? "hour" : "day-part"} slot reaches{" "}
          {minN} posts.{" "}
          {granularity === "hour"
            ? "Switch Granularity to Day-part, or lower Min posts per slot, to see an early read."
            : "Lower Min posts per slot for an exploratory read, or keep posting — the signal firms up as volume grows."}
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
                {spec.keys.map((key, i) => (
                  <th
                    key={key}
                    className={`text-center font-normal ${spec.cellWidthClass}`}
                    title={spec.slotLabel("", key).trim()}
                  >
                    {spec.header(key, i)}
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
                  {spec.keys.map((key, cIdx) => {
                    const cell = grid[dIdx][cIdx];
                    const qualifies = cell.posts.length >= minN;
                    const intensity =
                      cell.avg === null || max === 0 || !qualifies
                        ? 0
                        : cell.avg / max;
                    const bg = intensityColor(intensity);
                    const hasPosts = cell.posts.length > 0;
                    const isTopSlot = `${dIdx}-${cIdx}` === topSlotKey;
                    const slotLabel = spec.slotLabel(day, key);
                    const title = hasPosts
                      ? `${slotLabel} · ${
                          cell.posts.length
                        } post${cell.posts.length === 1 ? "" : "s"} · avg ${
                          metric.label
                        }: ${cell.avg !== null ? metric.format(cell.avg) : "—"}${
                          !qualifies ? " · below min-N threshold" : ""
                        }`
                      : `${slotLabel} · no posts`;
                    return (
                      <td
                        key={key}
                        className={`${spec.cellWidthClass} h-7 text-center align-middle ${
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
                            label: `${slotLabel} (${tzLabel})`,
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
          getMetricValue={metric.perPost}
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
