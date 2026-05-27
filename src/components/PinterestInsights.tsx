"use client";

import { useMemo, useState } from "react";
import {
  toTrendingKeyword,
  toTopPin,
  type TrendingKeyword,
  type TopPin,
} from "@/lib/types";
import { formatNumber, str } from "@/lib/utils";
import type { AirtableRecord } from "@/lib/utils";
import PostDrilldownPanel from "./PostDrilldownPanel";

interface PinterestInsightsProps {
  trends: AirtableRecord[];
  topPins: AirtableRecord[];
  /** Full Posts table — used to resolve a TopPin row to its full Post record. */
  posts?: AirtableRecord[];
  /** IANA timezone for date display in the drilldown panel. */
  timezone?: string;
}

const REGIONS_AVAILABLE: Array<TrendingKeyword["region"]> = ["GB+IE", "US"];
const TREND_TYPES_AVAILABLE: Array<TrendingKeyword["trendType"]> = [
  "growing",
  "monthly",
];
const SORT_BYS_AVAILABLE: Array<TopPin["sortBy"]> = [
  "IMPRESSION",
  "SAVE",
  "OUTBOUND_CLICK",
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
}

function TrendsPanel({ records }: TrendsPanelProps) {
  const [region, setRegion] = useState<TrendingKeyword["region"]>("GB+IE");
  const [trendType, setTrendType] =
    useState<TrendingKeyword["trendType"]>("growing");

  const keywords = useMemo(
    () => records.map(toTrendingKeyword),
    [records],
  );
  const latestDate = useMemo(() => latestSnapshotDate(keywords), [keywords]);

  const filtered = useMemo(
    () =>
      keywords
        .filter(
          (k) =>
            k.snapshotDate === latestDate &&
            k.region === region &&
            k.trendType === trendType,
        )
        .sort((a, b) => a.rank - b.rank)
        .slice(0, 25),
    [keywords, latestDate, region, trendType],
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
        <div className="flex gap-2">
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

      {filtered.length === 0 ? (
        <p className="text-xs" style={{ color: "var(--text-secondary)" }}>
          No trending keywords for this filter combination.
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
                  ? "#22c55e"
                  : recent.length >= 2 && recent[recent.length - 1] < recent[0]
                    ? "#ef4444"
                    : "#9ca3af";
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

/** Coloured growth-percentage cell. Caps display at "10000%+" (API max). */
function GrowthCell({ value }: { value: number }) {
  if (!Number.isFinite(value) || value === 0) {
    return (
      <span style={{ color: "var(--text-secondary)" }}>0%</span>
    );
  }
  const cls =
    value >= 100
      ? "text-green-400"
      : value >= 10
        ? "text-green-300"
        : value < 0
          ? "text-red-400"
          : "";
  const display = value >= 10001 ? "10000%+" : `${value > 0 ? "+" : ""}${value}%`;
  return <span className={cls}>{display}</span>;
}

interface TopPinsPanelProps {
  records: AirtableRecord[];
  posts: AirtableRecord[];
  timezone: string;
}

function TopPinsPanel({ records, posts, timezone }: TopPinsPanelProps) {
  const [sortBy, setSortBy] = useState<TopPin["sortBy"]>("OUTBOUND_CLICK");
  const [drilldown, setDrilldown] = useState<{
    posts: AirtableRecord[];
    label: string;
  } | null>(null);

  // Build a Post ID -> Post record lookup so row clicks resolve quickly.
  const postsByPostId = useMemo(() => {
    const m = new Map<string, AirtableRecord>();
    for (const p of posts) {
      const pid = str(p.fields["Post ID"]);
      if (pid) m.set(pid, p);
    }
    return m;
  }, [posts]);

  const pins = useMemo(() => records.map(toTopPin), [records]);
  const latestDate = useMemo(() => latestSnapshotDate(pins), [pins]);

  const filtered = useMemo(
    () =>
      pins
        .filter(
          (p) => p.snapshotDate === latestDate && p.sortBy === sortBy,
        )
        .sort((a, b) => a.rank - b.rank)
        .slice(0, 25),
    [pins, latestDate, sortBy],
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
          Pinterest Top Pins
          {latestDate && (
            <span className="ml-2 text-xs opacity-60">
              (last 30 days · {latestDate})
            </span>
          )}
        </h3>
        <div className="flex gap-1">
          {SORT_BYS_AVAILABLE.map((s) => (
            <button
              key={s}
              onClick={() => setSortBy(s)}
              className="text-xs px-2 py-1 rounded cursor-pointer transition-colors"
              style={{
                background:
                  sortBy === s ? "var(--accent-purple)" : "var(--bg-secondary)",
                color:
                  sortBy === s ? "#fff" : "var(--text-secondary)",
                border: "1px solid var(--border)",
              }}
            >
              {s.replace("_", " ")}
            </button>
          ))}
        </div>
      </div>

      {filtered.length === 0 ? (
        <p className="text-xs" style={{ color: "var(--text-secondary)" }}>
          No top-pins data for this metric yet.
        </p>
      ) : (
        <table className="w-full text-xs">
          <thead>
            <tr style={{ color: "var(--text-secondary)" }}>
              <th scope="col" className="text-left py-2 px-2 w-8">
                #
              </th>
              <th scope="col" className="text-left py-2 px-2">
                Pin
              </th>
              <th scope="col" className="text-right py-2 px-2">
                Impressions
              </th>
              <th scope="col" className="text-right py-2 px-2">
                Saves
              </th>
              <th scope="col" className="text-right py-2 px-2">
                Clicks (Out)
              </th>
              <th scope="col" className="text-right py-2 px-2">
                Engagement
              </th>
            </tr>
          </thead>
          <tbody>
            {filtered.map((p) => {
              const matchedPost = postsByPostId.get(p.postId);
              const hasMatch = !!matchedPost;
              return (
                <tr
                  key={p.id}
                  className={`border-t hover:bg-white/5 transition-colors ${
                    hasMatch ? "cursor-pointer" : ""
                  }`}
                  style={{ borderColor: "var(--border)" }}
                  onClick={() => {
                    if (matchedPost) {
                      setDrilldown({
                        posts: [matchedPost],
                        label: `Pin #${p.rank} by ${p.sortBy.replace("_", " ")}`,
                      });
                    }
                  }}
                  title={
                    hasMatch
                      ? "Click to see full post detail"
                      : "No matching Post record (pin may be older than 30d)"
                  }
                >
                  <td className="py-2 px-2 opacity-50">{p.rank}</td>
                  <td className="py-2 px-2">
                    <a
                      href={`https://www.pinterest.com/pin/${p.pinId}/`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="hover:underline"
                      style={{ color: "var(--accent-purple)" }}
                      onClick={(e) => e.stopPropagation()}
                    >
                      {p.pinId.slice(-10)}
                    </a>
                    {hasMatch && (
                      <span
                        className="ml-2 text-[10px]"
                        style={{ color: "var(--text-secondary)" }}
                      >
                        ↗ details
                      </span>
                    )}
                  </td>
                  <td className="py-2 px-2 text-right">
                    {formatNumber(p.impressions)}
                  </td>
                  <td className="py-2 px-2 text-right">{p.saves}</td>
                  <td className="py-2 px-2 text-right font-medium">
                    {p.outboundClick > 0 ? p.outboundClick : "—"}
                  </td>
                  <td className="py-2 px-2 text-right">{p.engagement}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}

      {drilldown && (
        <PostDrilldownPanel
          posts={drilldown.posts}
          bucketLabel={drilldown.label}
          timezone={timezone}
          onClose={() => setDrilldown(null)}
        />
      )}
    </div>
  );
}

export default function PinterestInsights({
  trends,
  topPins,
  posts = [],
  timezone = "",
}: PinterestInsightsProps) {
  if (trends.length === 0 && topPins.length === 0) {
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
          Pinterest Insights
        </h3>
        <p className="text-xs" style={{ color: "var(--text-secondary)" }}>
          No Pinterest Trends or Top Pins data yet. The Pinterest Trends
          Refresher runs daily — wait for the next scheduled run.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <TrendsPanel records={trends} />
      <TopPinsPanel records={topPins} posts={posts} timezone={timezone} />
    </div>
  );
}
