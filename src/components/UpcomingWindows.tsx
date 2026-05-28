"use client";

import { useMemo, useState } from "react";
import {
  toSeasonalOpportunity,
  upcomingWindows,
  type SeasonalMarket,
} from "@/lib/seasonal";
import { toTrendingKeyword } from "@/lib/types";
import type { AirtableRecord } from "@/lib/utils";

interface UpcomingWindowsProps {
  seasonalOpportunities: AirtableRecord[];
  pinterestTrends: AirtableRecord[];
}

const MARKETS_AVAILABLE: ReadonlyArray<SeasonalMarket | "All"> = [
  "All",
  "UK",
  "DE",
  "US",
  "Global",
];

/**
 * Planning's Seasonal Windows panel — surfaces recurring annual moments
 * approaching (or currently inside) their 4-week lead window, with matching
 * Pinterest trending keywords inline so the planner sees both the moment
 * AND the demand signal in one place.
 */
export default function UpcomingWindows({
  seasonalOpportunities,
  pinterestTrends,
}: UpcomingWindowsProps) {
  const [marketFilter, setMarketFilter] = useState<SeasonalMarket | "All">(
    "All",
  );

  const opportunities = useMemo(
    () => seasonalOpportunities.map(toSeasonalOpportunity),
    [seasonalOpportunities],
  );

  const windows = useMemo(
    () => upcomingWindows(opportunities, new Date(), 90, 4),
    [opportunities],
  );

  // Filter by market AFTER computing windows so the "X of Y in window" count
  // stays accurate to the filter.
  const filtered = useMemo(
    () =>
      marketFilter === "All"
        ? windows
        : windows.filter((w) => w.opportunity.markets.includes(marketFilter)),
    [windows, marketFilter],
  );

  // Latest snapshot's trending keywords, indexed lowercase for substring match.
  const latestTrends = useMemo(() => {
    if (pinterestTrends.length === 0) return [];
    const all = pinterestTrends.map(toTrendingKeyword);
    const maxDate = all.reduce(
      (m, k) => (k.snapshotDate > m ? k.snapshotDate : m),
      all[0].snapshotDate,
    );
    return all.filter((k) => k.snapshotDate === maxDate);
  }, [pinterestTrends]);

  if (opportunities.length === 0) {
    return (
      <div
        className="rounded-xl p-5 text-xs"
        style={{
          background: "var(--bg-card)",
          border: "1px solid var(--border)",
          color: "var(--text-secondary)",
        }}
      >
        No Seasonal Opportunities loaded yet. Check the Airtable table.
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <div
        className="flex items-center justify-between flex-wrap gap-2 px-1"
      >
        <span className="text-xs" style={{ color: "var(--text-secondary)" }}>
          Next 90 days · {filtered.length} moments
          {filtered.length !== windows.length && ` (filtered from ${windows.length})`}
        </span>
        <div className="flex gap-1">
          {MARKETS_AVAILABLE.map((m) => (
            <button
              key={m}
              onClick={() => setMarketFilter(m)}
              className="text-xs px-2 py-1 rounded cursor-pointer transition-colors"
              style={{
                background:
                  marketFilter === m
                    ? "var(--brand)"
                    : "var(--bg-secondary)",
                color: marketFilter === m ? "#fff" : "var(--text-secondary)",
                border: "1px solid var(--border)",
              }}
            >
              {m}
            </button>
          ))}
        </div>
      </div>

      {filtered.length === 0 ? (
        <div
          className="rounded-xl p-5 text-xs"
          style={{
            background: "var(--bg-card)",
            border: "1px solid var(--border)",
            color: "var(--text-secondary)",
          }}
        >
          No upcoming moments for this market in the next 90 days.
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          {filtered.map((w) => {
            const matchedTrends = latestTrends.filter((t) => {
              const keyword = t.keyword.toLowerCase();
              return w.opportunity.trendKeywords.some((kw) =>
                keyword.includes(kw),
              );
            });
            const daysLabel =
              w.daysUntilPeak === 0
                ? "today"
                : w.daysUntilPeak < 0
                  ? `${Math.abs(w.daysUntilPeak)}d ago`
                  : `in ${w.daysUntilPeak}d`;
            const statusLabel = w.postPeak
              ? "tail"
              : w.inWindow
                ? "in window"
                : "upcoming";
            const statusColor = w.postPeak
              ? "var(--text-secondary)"
              : w.inWindow
                ? "var(--warning)"
                : "var(--info)";

            return (
              <div
                key={w.opportunity.id}
                className="rounded-xl p-4 space-y-2"
                style={{
                  background: "var(--bg-card)",
                  border: "1px solid var(--border)",
                }}
              >
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <h4
                      className="text-sm font-medium"
                      style={{ color: "var(--text-primary)" }}
                    >
                      {w.opportunity.name}
                    </h4>
                    <div
                      className="text-xs flex items-center gap-2 mt-0.5"
                      style={{ color: "var(--text-secondary)" }}
                    >
                      <span>{w.peak.toISOString().slice(0, 10)}</span>
                      <span>·</span>
                      <span>{daysLabel}</span>
                      <span>·</span>
                      <span>{w.opportunity.markets.join(", ")}</span>
                    </div>
                  </div>
                  <span
                    className="text-[10px] px-1.5 py-0.5 rounded font-medium"
                    style={{
                      background: statusColor + "22",
                      color: statusColor,
                      border: `1px solid ${statusColor}55`,
                    }}
                  >
                    {statusLabel}
                  </span>
                </div>

                {w.opportunity.bootleAngle && (
                  <p
                    className="text-xs"
                    style={{ color: "var(--text-secondary)" }}
                  >
                    {w.opportunity.bootleAngle}
                  </p>
                )}

                {matchedTrends.length > 0 ? (
                  <div className="pt-1">
                    <div
                      className="text-[10px] uppercase tracking-wide mb-1"
                      style={{ color: "var(--text-secondary)" }}
                    >
                      Trending now ({matchedTrends.length} match
                      {matchedTrends.length === 1 ? "" : "es"})
                    </div>
                    <div className="flex flex-wrap gap-1">
                      {matchedTrends.slice(0, 8).map((t) => (
                        <span
                          key={`${t.id}`}
                          className="text-[11px] px-1.5 py-0.5 rounded"
                          style={{
                            background: "var(--bg-secondary)",
                            color: "var(--text-primary)",
                            border: "1px solid var(--border)",
                          }}
                          title={`Pinterest ${t.region} · WoW ${t.pctGrowthWoW}%`}
                        >
                          {t.keyword}
                        </span>
                      ))}
                    </div>
                  </div>
                ) : (
                  <div
                    className="text-[11px] pt-1"
                    style={{ color: "var(--text-secondary)" }}
                  >
                    No matching Pinterest trends in the latest snapshot.
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
