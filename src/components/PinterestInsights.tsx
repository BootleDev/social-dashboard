"use client";

import { useMemo, useState } from "react";
import {
  toTrendingKeyword,
  type TrendingKeyword,
} from "@/lib/types";
import { str } from "@/lib/utils";
import type { AirtableRecord } from "@/lib/utils";
import {
  toSeasonalOpportunity,
  buildBootleKeywordAllowlist,
  matchesBootleAllowlist,
} from "@/lib/seasonal";

interface PinterestInsightsProps {
  trends: AirtableRecord[];
  /** Seasonal Opportunities records — drives the Bootle-relevant allowlist. */
  seasonalOpportunities?: AirtableRecord[];
  posts?: AirtableRecord[];
  timezone?: string;
}

const REGIONS_AVAILABLE: Array<TrendingKeyword["region"]> = [
  "GB+IE",
  "US",
  "DE+AT+CH",
];
const TREND_TYPES_AVAILABLE: Array<TrendingKeyword["trendType"]> = [
  "growing",
  "monthly",
];

/**
 * Lightweight inline SVG sparkline. Renders the 52-week series as a polyline
 * with a faint area-fill and a tip marker on the latest point. Chosen over
 * react-chartjs-2 here because a row table would mount 25 chart instances,
 * each with its own canvas + animation loop — pure SVG is ~50x cheaper.
 */
function Sparkline({
  values,
  width = 100,
  height = 28,
  color,
}: {
  values: number[];
  width?: number;
  height?: number;
  color: string;
}) {
  if (values.length < 2) {
    return (
      <span style={{ color: "var(--text-secondary)" }} className="text-[10px]">
        —
      </span>
    );
  }
  const max = Math.max(...values, 1);
  const min = Math.min(...values);
  const range = max - min || 1;
  const stepX = width / (values.length - 1);
  const points = values.map((v, i) => {
    const x = i * stepX;
    const y = height - ((v - min) / range) * height;
    return [x, y] as const;
  });
  const path = points
    .map(([x, y], i) => (i === 0 ? `M${x},${y}` : `L${x},${y}`))
    .join(" ");
  const area = `${path} L${width},${height} L0,${height} Z`;
  const [lastX, lastY] = points[points.length - 1];
  return (
    <svg width={width} height={height} className="block">
      <path d={area} fill={color} opacity={0.15} />
      <path d={path} fill="none" stroke={color} strokeWidth={1.25} />
      <circle cx={lastX} cy={lastY} r={1.75} fill={color} />
    </svg>
  );
}

/** Parse the JSON time-series field safely; return values array (chronological). */
function parseTimeSeries(json: string): number[] {
  if (!json) return [];
  try {
    const obj = JSON.parse(json) as Record<string, number>;
    return Object.keys(obj)
      .sort()
      .map((k) => obj[k]);
  } catch {
    return [];
  }
}

/** Returns the most recent snapshot date present, or empty string. */
function latestSnapshotDate<T extends { snapshotDate: string }>(
  records: T[],
): string {
  if (records.length === 0) return "";
  return records.reduce(
    (max, r) => (r.snapshotDate > max ? r.snapshotDate : max),
    records[0].snapshotDate,
  );
}

interface TrendsPanelProps {
  records: AirtableRecord[];
  /** Keyword allowlist used by the Bootle-relevant filter. */
  bootleAllowlist: string[];
}

function TrendsPanel({ records, bootleAllowlist }: TrendsPanelProps) {
  // Default to US: it is consistently the only region whose top trends carry
  // Bootle-relevant gifting/wellness signal. GB+IE and DACH top-trending are
  // dominated by entertainment/nail/anime search noise with near-zero relevant
  // terms, so defaulting there showed an empty panel (WEBDEV-182 follow-up).
  const [region, setRegion] = useState<TrendingKeyword["region"]>("US");
  const [trendType, setTrendType] =
    useState<TrendingKeyword["trendType"]>("growing");
  // Default ON — the global trends list is full of pop-culture noise that
  // isn't actionable for a drinkware brand. Toggle off to see the full list.
  const [bootleOnly, setBootleOnly] = useState(true);

  const keywords = useMemo(
    () => records.map(toTrendingKeyword),
    [records],
  );
  const latestDate = useMemo(() => latestSnapshotDate(keywords), [keywords]);

  const baseFiltered = useMemo(
    () =>
      keywords
        .filter(
          (k) =>
            k.snapshotDate === latestDate &&
            k.region === region &&
            k.trendType === trendType,
        )
        .sort((a, b) => a.rank - b.rank),
    [keywords, latestDate, region, trendType],
  );

  const filtered = useMemo(() => {
    const list = bootleOnly
      ? baseFiltered.filter((k) =>
          matchesBootleAllowlist(k.keyword, bootleAllowlist),
        )
      : baseFiltered;
    return list.slice(0, 25);
  }, [baseFiltered, bootleOnly, bootleAllowlist]);

  const bootleMatchCount = useMemo(
    () =>
      baseFiltered.filter((k) =>
        matchesBootleAllowlist(k.keyword, bootleAllowlist),
      ).length,
    [baseFiltered, bootleAllowlist],
  );

  return (
    <div
      className="rounded-xl p-5"
      style={{
        background: "var(--bg-card)",
        border: "1px solid var(--border)",
      }}
    >
      <div className="flex items-center justify-between mb-4 flex-wrap gap-2">
        <h3
          className="text-sm font-medium"
          style={{ color: "var(--text-secondary)" }}
        >
          Pinterest Trending Keywords
          {latestDate && (
            <span className="ml-2 text-xs opacity-60">({latestDate})</span>
          )}
        </h3>
        <div className="flex gap-2 flex-wrap items-center">
          <label
            className="text-xs flex items-center gap-1.5 cursor-pointer px-2 py-1 rounded"
            style={{
              background: bootleOnly ? "var(--brand)" : "var(--bg-secondary)",
              color: bootleOnly ? "#fff" : "var(--text-secondary)",
              border: "1px solid var(--border)",
            }}
            title="Filter to Bootle-relevant keywords (drawn from Seasonal Opportunities + content pillars)"
          >
            <input
              type="checkbox"
              checked={bootleOnly}
              onChange={(e) => setBootleOnly(e.target.checked)}
              className="cursor-pointer"
            />
            Bootle-relevant
            <span className="opacity-70 text-[10px]">
              ({bootleMatchCount} match{bootleMatchCount === 1 ? "" : "es"})
            </span>
          </label>
          <select
            value={region}
            onChange={(e) =>
              setRegion(e.target.value as TrendingKeyword["region"])
            }
            className="text-xs px-2 py-1 rounded cursor-pointer"
            style={{
              background: "var(--bg-secondary)",
              border: "1px solid var(--border)",
              color: "var(--text-primary)",
            }}
          >
            {REGIONS_AVAILABLE.map((r) => (
              <option key={r} value={r}>
                {r}
              </option>
            ))}
          </select>
          <select
            value={trendType}
            onChange={(e) =>
              setTrendType(e.target.value as TrendingKeyword["trendType"])
            }
            className="text-xs px-2 py-1 rounded cursor-pointer"
            style={{
              background: "var(--bg-secondary)",
              border: "1px solid var(--border)",
              color: "var(--text-primary)",
            }}
          >
            {TREND_TYPES_AVAILABLE.map((t) => (
              <option key={t} value={t}>
                {t}
              </option>
            ))}
          </select>
        </div>
      </div>

      <p
        className="text-[10px] mb-2"
        style={{ color: "var(--text-secondary)" }}
      >
        Available regions: US, GB+IE, DE+AT+CH. Snapshots refresh daily at
        01:00 UTC.
      </p>

      {filtered.length === 0 ? (
        <p className="text-xs" style={{ color: "var(--text-secondary)" }}>
          {bootleOnly
            ? "No Bootle-relevant trending keywords for this filter combination. Toggle 'Bootle-relevant' off to see the full list."
            : "No trending keywords for this filter combination."}
        </p>
      ) : (
        <table className="w-full text-xs">
          <thead>
            <tr style={{ color: "var(--text-secondary)" }}>
              <th scope="col" className="text-left py-2 px-2 w-8">
                #
              </th>
              <th scope="col" className="text-left py-2 px-2">
                Keyword
              </th>
              <th scope="col" className="text-center py-2 px-2 w-[110px]">
                52w trend
              </th>
              <th scope="col" className="text-right py-2 px-2">
                WoW %
              </th>
              <th scope="col" className="text-right py-2 px-2">
                MoM %
              </th>
              <th scope="col" className="text-right py-2 px-2">
                YoY %
              </th>
            </tr>
          </thead>
          <tbody>
            {filtered.map((k) => {
              const series = parseTimeSeries(k.timeSeriesJson);
              // Color the sparkline by recent-direction: green if last 4w net
              // up, red if down, neutral otherwise. Quick glanceable signal.
              const recent = series.slice(-4);
              const sparkColor =
                recent.length >= 2 && recent[recent.length - 1] > recent[0]
                  ? "var(--success)"
                  : recent.length >= 2 && recent[recent.length - 1] < recent[0]
                    ? "var(--danger)"
                    : "var(--text-secondary)";
              return (
                <tr
                  key={k.id}
                  className="border-t hover:bg-white/5 transition-colors"
                  style={{ borderColor: "var(--border)" }}
                >
                  <td className="py-2 px-2 opacity-50">{k.rank}</td>
                  <td className="py-2 px-2">{k.keyword}</td>
                  <td className="py-2 px-2 flex justify-center items-center">
                    <Sparkline values={series} color={sparkColor} />
                  </td>
                  <td className="py-2 px-2 text-right">
                    <GrowthCell value={k.pctGrowthWoW} />
                  </td>
                  <td className="py-2 px-2 text-right">
                    <GrowthCell value={k.pctGrowthMoM} />
                  </td>
                  <td className="py-2 px-2 text-right">
                    <GrowthCell value={k.pctGrowthYoY} />
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
    </div>
  );
}

/**
 * Above this growth %, the figure is almost always a low-base artifact — a
 * keyword that barely existed in the comparison period. Pinterest also caps
 * the value here. Rather than print a pseudo-precise "10000%+" (which reads as
 * a measured 100x jump), we show a categorical "breakout" label.
 */
export const GROWTH_BREAKOUT_THRESHOLD = 1000;

export type GrowthKind = "zero" | "breakout" | "up" | "down";

/**
 * Decide how a growth percentage should display. A value at or above the
 * breakout threshold is treated as a near-zero-base artifact and labelled
 * "breakout" instead of a pseudo-precise "10000%+", which would read as a
 * measured 100x jump. Pure + exported so the rule is unit-testable.
 */
export function formatGrowthDisplay(value: number): {
  label: string;
  kind: GrowthKind;
} {
  if (!Number.isFinite(value) || value === 0) return { label: "0%", kind: "zero" };
  if (value >= GROWTH_BREAKOUT_THRESHOLD)
    return { label: "breakout", kind: "breakout" };
  return {
    label: `${value > 0 ? "+" : ""}${value}%`,
    kind: value < 0 ? "down" : "up",
  };
}

/** Coloured growth-percentage cell. Huge low-base values show as "breakout". */
function GrowthCell({ value }: { value: number }) {
  const { label, kind } = formatGrowthDisplay(value);
  if (kind === "zero") {
    return <span style={{ color: "var(--text-secondary)" }}>{label}</span>;
  }
  if (kind === "breakout") {
    return (
      <span
        className="text-success"
        title="Breakout from a near-zero base in the comparison period — the true multiple is not meaningful, only that the term went from almost nothing to trending."
      >
        {label}
      </span>
    );
  }
  const cls = kind === "down" ? "text-danger" : "text-success";
  return <span className={cls}>{label}</span>;
}

export default function PinterestInsights({
  trends,
  seasonalOpportunities = [],
  posts: _posts = [],
  timezone: _timezone = "",
}: PinterestInsightsProps) {
  void _posts;
  void _timezone;

  const bootleAllowlist = useMemo(
    () =>
      buildBootleKeywordAllowlist(
        seasonalOpportunities.map(toSeasonalOpportunity),
      ),
    [seasonalOpportunities],
  );

  if (trends.length === 0) {
    return (
      <div
        className="rounded-xl p-5"
        style={{
          background: "var(--bg-card)",
          border: "1px solid var(--border)",
        }}
      >
        <h3
          className="text-sm font-medium mb-3"
          style={{ color: "var(--text-secondary)" }}
        >
          Pinterest Trending Keywords
        </h3>
        <p className="text-xs" style={{ color: "var(--text-secondary)" }}>
          No Pinterest Trends data yet. The Pinterest Trends Refresher runs
          daily — wait for the next scheduled run.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <TrendsPanel records={trends} bootleAllowlist={bootleAllowlist} />
    </div>
  );
}
