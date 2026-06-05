"use client";

import { useState, useEffect, useMemo, useCallback } from "react";
import Link from "next/link";
import Overview from "@/components/Overview";
import ContentAnalysis from "@/components/ContentAnalysis";
import PostDrilldownPanel from "@/components/PostDrilldownPanel";
import PlanningPanel from "@/components/PlanningPanel";
import OpsPanel from "@/components/OpsPanel";
import DateRangeFilter from "@/components/DateRangeFilter";
import type { DateRange } from "@/components/DateRangeFilter";
import PlatformFilter from "@/components/PlatformFilter";
import TimezoneSelector from "@/components/TimezoneSelector";
import ThemeToggle from "@/components/ThemeToggle";
import { useTimezone } from "@/lib/useTimezone";
import ChatBox from "@/components/ChatBox";
import LoadingSkeleton from "@/components/LoadingSkeleton";
import ErrorBoundary from "@/components/ErrorBoundary";
import OutOfRangeNotice from "@/components/OutOfRangeNotice";
import { str, getComparisonPeriod, getPlatformKeys } from "@/lib/utils";
import { getPlatformConfig } from "@/lib/platforms";
import type { AirtableRecord } from "@/lib/utils";
import type { PlanSelection } from "@/lib/planSelection";

/**
 * Tab structure (2026-05-26 IA rewrite):
 * - pulse: daily check-in. KPIs + alerts + summaries.
 * - insights: deep EDA for "why is X behaving this way".
 * - planning: content production tools — when, what, who.
 * - ops: admin (tagging, platform compare, health).
 *
 * Old tabs (overview/content/audience/pinterest/compare/competitors/tagging)
 * are merged into the four above; component reuse is preserved.
 */
type Tab = "pulse" | "insights" | "planning" | "ops";

interface DashboardData {
  posts: AirtableRecord[];
  // Legacy account table. Retired as the source of account-grain KPIs
  // (WEBDEV-146) — kept on the payload only for any non-KPI legacy reader.
  dailyMetrics: AirtableRecord[];
  // Sole source for account-grain KPIs (Followers, Reach, Impressions, ER).
  // Optional so a mid-deploy cached payload without this key doesn't break the UI.
  accountDailyFacts?: AirtableRecord[];
  weeklySummaries: AirtableRecord[];
  alerts: AirtableRecord[];
  // Per-channel feeds (added 2026-05-26). Optional so older API responses
  // (cached, mid-deploy) don't break the UI; components treat empty as no-data.
  instagramAudience?: AirtableRecord[];
  pinterestTrends?: AirtableRecord[];
  pinterestTopPins?: AirtableRecord[];
  seasonalOpportunities?: AirtableRecord[];
}

function filterByPlatform(
  records: AirtableRecord[],
  selected: Set<string>,
): AirtableRecord[] {
  if (selected.size === 0) return records;
  return records.filter((r) => {
    const platform = str(r.fields["Platform"]).toLowerCase().trim();
    return selected.has(platform);
  });
}

function filterByDateRange(
  records: AirtableRecord[],
  dateField: string,
  range: DateRange,
): AirtableRecord[] {
  if (!range.start && !range.end) return records;
  return records.filter((r) => {
    const d = str(r.fields[dateField]).split("T")[0];
    if (!d) return false;
    if (range.start && d < range.start) return false;
    if (range.end && d > range.end) return false;
    return true;
  });
}

export default function DashboardPage() {
  const [tab, setTab] = useState<Tab>("pulse");
  const [data, setData] = useState<DashboardData | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [dateRange, setDateRange] = useState<DateRange>(() => {
    // Default to Last 30 days — the prior "All Time" default included every
    // historical record and made period-over-period comparisons meaningless.
    const end = new Date();
    const start = new Date(end);
    start.setUTCDate(start.getUTCDate() - 29);
    return {
      start: start.toISOString().split("T")[0],
      end: end.toISOString().split("T")[0],
      label: "Last 30 days",
    };
  });
  const [selectedPlatforms, setSelectedPlatforms] = useState<Set<string>>(
    new Set(),
  );
  const [competitorRecords, setCompetitorRecords] = useState<AirtableRecord[]>(
    [],
  );
  const [competitorLoading, setCompetitorLoading] = useState(false);
  const [competitorError, setCompetitorError] = useState("");
  const [competitorFetched, setCompetitorFetched] = useState(false);
  const [timezone, setTimezone] = useTimezone();
  // Post opened from a Pulse alert click; rendered in PostDrilldownPanel.
  const [selectedPost, setSelectedPost] = useState<AirtableRecord | null>(null);
  // Cross-tab carry from Insights ("what worked") to Planning ("when to post").
  // Set by "Plan from this →" on a winning Theme × Post Type bar; consumed by
  // the When-to-post heatmap. Switching tabs is part of the same action, so the
  // setter below also routes the user to Planning.
  const [planSelection, setPlanSelection] = useState<PlanSelection | null>(null);

  const planFromSelection = useCallback((sel: PlanSelection) => {
    setPlanSelection(sel);
    setTab("planning");
  }, []);

  const fetchData = useCallback((force = false) => {
    // MARKETING-19 Fix 7: when force=true (Refresh button), bypass the 30-min
    // server-side fetch cache by appending ?nocache=1. Initial page load
    // (force=false) keeps caching for performance.
    setLoading(true);
    setError("");
    fetch(force ? "/api/airtable?nocache=1" : "/api/airtable")
      .then((res) => {
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        return res.json();
      })
      .then((d) => setData(d))
      .catch((err) => setError(err.message))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  // Lazy-fetch competitor data when Planning tab is selected (competitors live
  // inside Planning now, under "Competitor signal").
  useEffect(() => {
    if (tab !== "planning" || competitorFetched) return;
    setCompetitorLoading(true);
    setCompetitorError("");
    fetch("/api/competitors")
      .then((res) => {
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        return res.json();
      })
      .then((d) => {
        setCompetitorRecords(d.records);
        setCompetitorFetched(true);
      })
      .catch((err) => setCompetitorError(err.message))
      .finally(() => setCompetitorLoading(false));
  }, [tab, competitorFetched]);

  // Filter data by date range
  const filteredPosts = useMemo(
    () =>
      data
        ? filterByPlatform(
            filterByDateRange(data.posts, "Published At", dateRange),
            selectedPlatforms,
          )
        : [],
    [data, dateRange, selectedPlatforms],
  );
  // Account-grain KPI source (WEBDEV-146). Date+platform filtered, read from
  // Account Daily Facts. This is the account-KPI input to both Overview and the
  // Ops-tab Platform Compare (the legacy Daily Account Metrics feed is retired
  // for account KPIs).
  const filteredAccountFacts = useMemo(
    () =>
      data
        ? filterByPlatform(
            filterByDateRange(
              data.accountDailyFacts ?? [],
              "Date",
              dateRange,
            ),
            selectedPlatforms,
          )
        : [],
    [data, dateRange, selectedPlatforms],
  );
  // Unfiltered account facts (platform filter only, NO date range) — the IG
  // 30-day period figures live on the latest row and must not be date-gated.
  const accountFactsAllDates = useMemo(
    () =>
      data
        ? filterByPlatform(data.accountDailyFacts ?? [], selectedPlatforms)
        : [],
    [data, selectedPlatforms],
  );
  const filteredAlerts = useMemo(
    () =>
      data
        ? filterByPlatform(
            filterByDateRange(data.alerts, "Alert Date", dateRange),
            selectedPlatforms,
          )
        : [],
    [data, dateRange, selectedPlatforms],
  );

  // Weekly summaries are NOT filtered by the dashboard date range or platform.
  // Each summary is a discrete weekly document, and the WeeklySummary panel has
  // its own report picker for browsing history — gating it by the (default
  // 30-day) range would hide most reports and starve the picker. So we pass the
  // full set, sorted newest-first so summaries[0] is always the latest (the
  // picker relies on that ordering).
  // Not platform-filtered either: Weekly Summary records have no "Platform"
  // field (they hold a cross-platform "Platform Breakdown" instead).
  const filteredSummaries = useMemo(() => {
    if (!data) return [];
    return [...data.weeklySummaries].sort((a, b) =>
      str(b.fields["Week Start"]).localeCompare(str(a.fields["Week Start"])),
    );
  }, [data]);

  // Comparison period posts (same duration, immediately before selected range).
  // Account-level prior-period comparison uses comparisonAccountFacts below
  // (Account Daily Facts), NOT the retired Daily Account Metrics table — the old
  // comparisonDaily built from data.dailyMetrics was removed 2026-06-04 as a
  // dead legacy-table trap (WEBDEV-146).
  const comparisonPosts = useMemo(() => {
    if (!data) return [];
    const comp = getComparisonPeriod(dateRange.start, dateRange.end);
    if (!comp) return [];
    return filterByPlatform(
      filterByDateRange(data.posts, "Published At", {
        start: comp.compStart,
        end: comp.compEnd,
        label: "",
      }),
      selectedPlatforms,
    );
  }, [data, dateRange, selectedPlatforms]);

  // Prior-period account facts, for period-over-period change on account KPIs.
  const comparisonAccountFacts = useMemo(() => {
    if (!data) return [];
    const comp = getComparisonPeriod(dateRange.start, dateRange.end);
    if (!comp) return [];
    return filterByPlatform(
      filterByDateRange(data.accountDailyFacts ?? [], "Date", {
        start: comp.compStart,
        end: comp.compEnd,
        label: "",
      }),
      selectedPlatforms,
    );
  }, [data, dateRange, selectedPlatforms]);

  // Latest data date
  const latestDataDate = useMemo(() => {
    if (!data || !data.dailyMetrics.length) return null;
    const dates = data.dailyMetrics
      .map((r) => str(r.fields["Date"]).split("T")[0])
      .filter(Boolean)
      .sort()
      .reverse();
    return dates[0] || null;
  }, [data]);

  // Active platforms from all daily metrics (not filtered)
  const activePlatforms = useMemo(
    () => (data ? getPlatformKeys(data.dailyMetrics) : []),
    [data],
  );

  // Initialize selected platforms when data loads (all on by default)
  useEffect(() => {
    if (activePlatforms.length > 0 && selectedPlatforms.size === 0) {
      setSelectedPlatforms(new Set(activePlatforms));
    }
  }, [activePlatforms, selectedPlatforms.size]);

  const tabs: { key: Tab; label: string; description: string }[] = [
    {
      key: "pulse",
      label: "Pulse",
      description: "Daily check-in: what happened, what's working, what needs attention",
    },
    {
      key: "insights",
      label: "Insights",
      description: "Deep EDA: why is content behaving this way, what shapes drive what outcomes",
    },
    {
      key: "planning",
      label: "Planning",
      description: "Content production: when to post, what to make, who to reach, who to learn from",
    },
    {
      key: "ops",
      label: "Ops",
      description: "Tagging, platform comparison, pipeline health",
    },
  ];

  return (
    <div className="min-h-screen">
      {/* Header */}
      <header
        className="sticky top-0 z-10 px-4 sm:px-6 py-3 sm:py-4 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3"
        style={{
          background: "var(--bg-primary)",
          borderBottom: "1px solid var(--border)",
          backdropFilter: "blur(8px)",
        }}
      >
        <div className="shrink-0">
          <h1 className="text-lg font-bold">Bootle Social Intelligence</h1>
          <div className="flex items-center gap-2">
            <div
              className="flex items-center gap-2 text-xs"
              style={{ color: "var(--text-secondary)" }}
            >
              {latestDataDate ? (
                <>
                  {activePlatforms.map((key) => {
                    const config = getPlatformConfig(key);
                    return (
                      <span
                        key={key}
                        className="inline-block w-1.5 h-1.5 rounded-full"
                        style={{ background: config.color }}
                        title={config.label}
                      />
                    );
                  })}
                  <span title="Daily data is stamped by UTC calendar date. Late-evening US time can read as 'tomorrow' because it is already the next day in UTC — this is the data's own date, not a future date.">
                    Last data: {latestDataDate} UTC
                  </span>
                </>
              ) : loading ? (
                "Loading..."
              ) : (
                "No data"
              )}
            </div>
            {!loading && data && (
              <button
                onClick={() => fetchData(true)}
                className="text-[10px] px-1.5 py-0.5 rounded transition-colors hover:bg-white/10 cursor-pointer"
                style={{ color: "var(--text-secondary)" }}
                title="Refresh data (bypasses cache)"
              >
                Refresh
              </button>
            )}
            <Link
              href="/dashboard/methodology"
              className="text-[10px] px-1.5 py-0.5 rounded transition-colors hover:bg-white/10 cursor-pointer"
              style={{ color: "var(--text-secondary)" }}
              title="How these numbers are sourced"
            >
              Methodology
            </Link>
          </div>
        </div>

        <div className="flex items-center gap-2 sm:gap-3 flex-wrap justify-end">
          {data && (
            <DateRangeFilter value={dateRange} onChange={setDateRange} />
          )}

          {activePlatforms.length > 1 && (
            <PlatformFilter
              platforms={activePlatforms}
              selected={selectedPlatforms}
              onChange={setSelectedPlatforms}
            />
          )}

          <TimezoneSelector value={timezone} onChange={setTimezone} />

          <ThemeToggle />

          <nav
            className="flex gap-1 rounded-lg p-1"
            style={{ background: "var(--bg-secondary)" }}
            role="tablist"
            aria-label="Dashboard sections"
          >
            {tabs.map((t) => (
              <button
                key={t.key}
                onClick={() => setTab(t.key)}
                role="tab"
                aria-selected={tab === t.key}
                title={t.description}
                className={`px-3 py-2 rounded-md text-xs font-medium transition-all cursor-pointer ${
                  tab === t.key ? "text-white" : ""
                }`}
                style={{
                  background: tab === t.key ? "var(--brand)" : "transparent",
                  color: tab === t.key ? "#fff" : "var(--text-secondary)",
                }}
              >
                {t.label}
              </button>
            ))}
          </nav>
        </div>
      </header>

      {/* Content. Extra bottom padding on small screens so the last card clears
          the fixed "Ask AI" FAB (bottom-6 + button height); on sm+ the FAB sits
          in the side gutter so the normal padding is enough (WEBDEV-182 item 15). */}
      <main className="p-6 pb-28 sm:pb-6 max-w-[1400px] mx-auto">
        {loading && <LoadingSkeleton />}

        {error && (
          <div
            className="rounded-xl p-6 text-sm"
            style={{
              border: "1px solid var(--danger)",
              background: "var(--danger-soft)",
              color: "var(--danger)",
            }}
          >
            Error loading data: {error}
          </div>
        )}

        {data && !loading && (
          <ErrorBoundary>
            <OutOfRangeNotice
              allPosts={data.posts}
              filteredPosts={filteredPosts}
              selectedPlatforms={selectedPlatforms}
              rangeLabel={dateRange.label}
            />
            <div role="tabpanel">
              {tab === "pulse" && (
                <Overview
                  posts={filteredPosts}
                  // Account-grain KPIs read from Account Daily Facts (WEBDEV-146),
                  // not the legacy Daily Account Metrics table.
                  dailyMetrics={filteredAccountFacts}
                  periodFacts={accountFactsAllDates}
                  alerts={filteredAlerts}
                  weeklySummaries={filteredSummaries}
                  prevPosts={comparisonPosts}
                  prevDailyMetrics={comparisonAccountFacts}
                  onSelectPost={setSelectedPost}
                />
              )}
              {tab === "insights" && (
                <ContentAnalysis
                  posts={filteredPosts}
                  timezone={timezone}
                  instagramAudience={data?.instagramAudience ?? []}
                  pinterestTopPins={data?.pinterestTopPins ?? []}
                  onPlanFromSelection={planFromSelection}
                />
              )}
              {tab === "planning" && (
                <PlanningPanel
                  posts={filteredPosts}
                  pinterestTrends={data?.pinterestTrends ?? []}
                  seasonalOpportunities={data?.seasonalOpportunities ?? []}
                  competitorRecords={competitorRecords}
                  competitorLoading={competitorLoading}
                  competitorError={competitorError}
                  timezone={timezone}
                  range={{ start: dateRange.start, end: dateRange.end }}
                  planSelection={planSelection}
                  onClearPlanSelection={() => setPlanSelection(null)}
                />
              )}
              {tab === "ops" && (
                <OpsPanel
                  posts={filteredPosts}
                  dailyMetrics={filteredAccountFacts}
                  // Raw (unfiltered) feeds for the Pipeline Health freshness
                  // view — it judges each feed's last-update date, so it must
                  // see every record, not the date/platform-filtered subset.
                  feeds={{
                    posts: data.posts,
                    accountDailyFacts: data.accountDailyFacts,
                    dailyMetrics: data.dailyMetrics,
                    alerts: data.alerts,
                    weeklySummaries: data.weeklySummaries,
                    instagramAudience: data.instagramAudience,
                    pinterestTrends: data.pinterestTrends,
                    pinterestTopPins: data.pinterestTopPins,
                    seasonalOpportunities: data.seasonalOpportunities,
                  }}
                />
              )}
            </div>
            {selectedPost && (
              <PostDrilldownPanel
                posts={[selectedPost]}
                bucketLabel={`Alert: ${str(selectedPost.fields["Post Type"]) || "post"} on ${str(selectedPost.fields["Platform"])}`}
                timezone={timezone}
                onClose={() => setSelectedPost(null)}
              />
            )}
          </ErrorBoundary>
        )}
      </main>

      <ChatBox />
    </div>
  );
}
