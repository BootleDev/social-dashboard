"use client";

import { useMemo, useState } from "react";
import PlatformCompare from "./PlatformCompare";
import TaggingPage from "@/app/dashboard/tagging/page";
import {
  buildFeedHealth,
  type FeedSpec,
  type FeedHealthRow,
  type FeedHealthStatus,
} from "@/lib/feedFreshness";
import type { AirtableRecord } from "@/lib/utils";

/**
 * Feeds the Pipeline Health view inspects. The keys match the dashboard data
 * payload; staleness windows reflect each feed's refresh cadence (most run
 * daily; weekly summaries are weekly; seasonal opportunities is a static
 * reference table, never "stale").
 */
const FEED_SPECS: FeedSpec[] = [
  { key: "posts", label: "Posts", dateField: "Published At", maxAgeDays: 4, note: "Latest post publish date (publishing cadence, not feed refresh)." },
  { key: "accountDailyFacts", label: "Account daily facts", dateField: "Date", maxAgeDays: 2, note: "Account-grain KPIs (followers, reach, impressions)." },
  { key: "dailyMetrics", label: "Daily account metrics (legacy)", dateField: "Date", maxAgeDays: 2, note: "Retired as KPI source; kept for legacy readers." },
  { key: "alerts", label: "Social alerts", dateField: "Alert Date", maxAgeDays: 3 },
  { key: "weeklySummaries", label: "Weekly summaries", dateField: "Week Start", maxAgeDays: 10, note: "One document per week." },
  { key: "instagramAudience", label: "Instagram audience", dateField: "Snapshot Date", maxAgeDays: 3 },
  { key: "pinterestTrends", label: "Pinterest trends", dateField: "Snapshot Date", maxAgeDays: 7 },
  { key: "pinterestTopPins", label: "Pinterest top pins", dateField: "Snapshot Date", maxAgeDays: 7 },
  { key: "seasonalOpportunities", label: "Seasonal opportunities", dateField: "", maxAgeDays: 0, reference: true, note: "Static reference table — no time series." },
];

interface OpsPanelProps {
  posts: AirtableRecord[];
  dailyMetrics: AirtableRecord[];
  /** Raw, unfiltered feed arrays keyed by feed name — for Pipeline Health. */
  feeds?: Record<string, AirtableRecord[] | undefined>;
}

type Sub = "tagging" | "platforms" | "health";

/**
 * Admin / ops workspace. Tagging UI for human content classification, cross-
 * platform comparison (technical view), and pipeline health.
 */
export default function OpsPanel({ posts, dailyMetrics, feeds }: OpsPanelProps) {
  const [sub, setSub] = useState<Sub>("tagging");

  const subs: { key: Sub; label: string; description: string }[] = [
    { key: "tagging", label: "Tagging", description: "Manually tag posts that AI hasn't caught" },
    { key: "platforms", label: "Platform Compare", description: "Cross-platform reach trends — technical view" },
    { key: "health", label: "Pipeline Health", description: "Data feed status + freshness" },
  ];

  return (
    <div className="space-y-4">
      <nav
        className="flex gap-2 rounded-lg p-1 w-fit"
        style={{ background: "var(--bg-secondary)" }}
      >
        {subs.map((s) => (
          <button
            key={s.key}
            onClick={() => setSub(s.key)}
            className="px-3 py-1.5 rounded text-xs font-medium transition-all cursor-pointer"
            style={{
              background:
                sub === s.key ? "var(--brand)" : "transparent",
              color: sub === s.key ? "#fff" : "var(--text-secondary)",
            }}
            title={s.description}
          >
            {s.label}
          </button>
        ))}
      </nav>

      {sub === "tagging" && <TaggingPage />}
      {sub === "platforms" && (
        <PlatformCompare posts={posts} dailyMetrics={dailyMetrics} />
      )}
      {sub === "health" && <PipelineHealth feeds={feeds ?? {}} />}
    </div>
  );
}

const STATUS_STYLE: Record<
  FeedHealthStatus,
  { label: string; color: string; bg: string }
> = {
  fresh: { label: "Fresh", color: "rgb(34, 197, 94)", bg: "rgba(34, 197, 94, 0.12)" },
  stale: { label: "Stale", color: "rgb(234, 179, 8)", bg: "rgba(234, 179, 8, 0.12)" },
  empty: { label: "No data", color: "rgb(239, 68, 68)", bg: "rgba(239, 68, 68, 0.12)" },
  reference: { label: "Reference", color: "var(--text-secondary)", bg: "var(--bg-secondary)" },
};

/**
 * Pipeline Health — per-feed freshness view. For each feed the dashboard reads,
 * show its last measured date, record count, and a fresh/stale/empty status
 * judged against the feed's expected cadence (WEBDEV-182 item 14).
 *
 * Freshness is computed against the browser's current date; the underlying
 * logic is pure and tested (see lib/feedFreshness).
 */
function PipelineHealth({
  feeds,
}: {
  feeds: Record<string, AirtableRecord[] | undefined>;
}) {
  const rows = useMemo<FeedHealthRow[]>(() => {
    // Today as a UTC yyyy-mm-dd, matching the UTC date-only convention the rest
    // of the dashboard uses for feed dates (the freshness fields are UTC dates).
    // The freshness math itself is the injected-`today` pure helper.
    const today = new Date().toISOString().split("T")[0];
    const data: Record<string, AirtableRecord[]> = {};
    for (const spec of FEED_SPECS) data[spec.key] = feeds[spec.key] ?? [];
    return buildFeedHealth(FEED_SPECS, data, today);
  }, [feeds]);

  const staleCount = rows.filter((r) => r.status === "stale").length;
  const emptyCount = rows.filter((r) => r.status === "empty").length;

  return (
    <div
      className="rounded-xl p-5 space-y-4"
      style={{
        background: "var(--bg-card)",
        border: "1px solid var(--border)",
      }}
    >
      <div className="flex items-baseline justify-between gap-2">
        <h3 className="text-sm font-medium" style={{ color: "var(--text-primary)" }}>
          Pipeline Health
        </h3>
        <span className="text-[11px]" style={{ color: "var(--text-secondary)" }}>
          {staleCount === 0 && emptyCount === 0
            ? "All feeds fresh"
            : `${staleCount} stale · ${emptyCount} empty`}
        </span>
      </div>

      <p className="text-[11px]" style={{ color: "var(--text-secondary)" }}>
        Feeds refresh daily via the n8n Social Data Refresher. A feed is{" "}
        <strong>stale</strong> when its newest record is older than its expected
        cadence, and <strong>no data</strong> when nothing has been ingested.
        Dates are UTC, matching the &quot;Last data&quot; header.
      </p>

      <div className="space-y-1.5">
        {rows.map((r) => {
          const s = STATUS_STYLE[r.status];
          return (
            <div
              key={r.key}
              className="grid items-center gap-3 text-xs py-1.5"
              style={{
                gridTemplateColumns: "1fr 110px 90px 80px",
                borderTop: "1px solid var(--border)",
              }}
            >
              <div>
                <div style={{ color: "var(--text-primary)" }}>{r.label}</div>
                {r.note && (
                  <div
                    className="text-[10px] leading-snug mt-0.5"
                    style={{ color: "var(--text-secondary)", opacity: 0.8 }}
                  >
                    {r.note}
                  </div>
                )}
              </div>
              <div
                className="tabular-nums text-[11px]"
                style={{ color: "var(--text-secondary)" }}
              >
                {r.lastDate ? `Last: ${r.lastDate}` : r.status === "reference" ? "—" : "never"}
              </div>
              <div
                className="tabular-nums text-[11px] text-right"
                style={{ color: "var(--text-secondary)" }}
              >
                {r.recordCount.toLocaleString()} rows
              </div>
              <div className="text-right">
                <span
                  className="inline-block px-2 py-0.5 rounded text-[10px] font-semibold"
                  style={{ background: s.bg, color: s.color }}
                >
                  {s.label}
                </span>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
