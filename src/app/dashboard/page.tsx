"use client";

import { useState, useEffect, useMemo, useCallback } from "react";
import Overview from "@/components/Overview";
import ContentAnalysis from "@/components/ContentAnalysis";
import AudienceGrowth from "@/components/AudienceGrowth";
import PlatformCompare from "@/components/PlatformCompare";
import CompetitorInsights from "@/components/CompetitorInsights";
import DateRangeFilter from "@/components/DateRangeFilter";
import type { DateRange } from "@/components/DateRangeFilter";
import PlatformFilter from "@/components/PlatformFilter";
import ChatBox from "@/components/ChatBox";
import LoadingSkeleton from "@/components/LoadingSkeleton";
import ErrorBoundary from "@/components/ErrorBoundary";
import { str, getComparisonPeriod, getPlatformKeys } from "@/lib/utils";
import { getPlatformConfig } from "@/lib/platforms";
import type { AirtableRecord } from "@/lib/utils";

type Tab = "overview" | "content" | "audience" | "compare" | "competitors";

interface DashboardData {
  posts: AirtableRecord[];
  dailyMetrics: AirtableRecord[];
  weeklySummaries: AirtableRecord[];
  alerts: AirtableRecord[];
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
  const [tab, setTab] = useState<Tab>("overview");
  const [data, setData] = useState<DashboardData | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [dateRange, setDateRange] = useState<DateRange>({
    start: null,
    end: null,
    label: "All Time",
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

  const fetchData = useCallback(() => {
    setLoading(true);
    setError("");
    fetch("/api/airtable")
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

  // Lazy-fetch competitor data when tab is selected
  useEffect(() => {
    if (tab !== "competitors" || competitorFetched) return;
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
  const filteredDaily = useMemo(
    () =>
      data
        ? filterByPlatform(
            filterByDateRange(data.dailyMetrics, "Date", dateRange),
            selectedPlatforms,
          )
        : [],
    [data, dateRange, selectedPlatforms],
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

  // Weekly summaries filtered by date range
  const filteredSummaries = useMemo(
    () =>
      data
        ? filterByPlatform(
            filterByDateRange(data.weeklySummaries, "Week Start", dateRange),
            selectedPlatforms,
          )
        : [],
    [data, dateRange, selectedPlatforms],
  );

  // Comparison period metrics (same duration, immediately before selected range)
  const comparisonDaily = useMemo(() => {
    if (!data) return [];
    const comp = getComparisonPeriod(dateRange.start, dateRange.end);
    if (!comp) return [];
    return filterByPlatform(
      filterByDateRange(data.dailyMetrics, "Date", {
        start: comp.compStart,
        end: comp.compEnd,
        label: "",
      }),
      selectedPlatforms,
    );
  }, [data, dateRange, selectedPlatforms]);

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

  const tabs: { key: Tab; label: string }[] = [
    { key: "overview", label: "Overview" },
    { key: "content", label: "Content Analysis" },
    { key: "audience", label: "Audience & Growth" },
    { key: "compare", label: "Platform Compare" },
    { key: "competitors", label: "Competitors" },
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
                  Last data: {latestDataDate}
                </>
              ) : loading ? (
                "Loading..."
              ) : (
                "No data"
              )}
            </div>
            {!loading && data && (
              <button
                onClick={fetchData}
                className="text-[10px] px-1.5 py-0.5 rounded transition-colors hover:bg-white/10 cursor-pointer"
                style={{ color: "var(--text-secondary)" }}
                title="Refresh data"
              >
                Refresh
              </button>
            )}
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
                className={`px-3 py-2 rounded-md text-xs font-medium transition-all cursor-pointer ${
                  tab === t.key ? "text-white" : ""
                }`}
                style={{
                  background:
                    tab === t.key ? "var(--accent-purple)" : "transparent",
                  color: tab === t.key ? "#fff" : "var(--text-secondary)",
                }}
              >
                {t.label}
              </button>
            ))}
          </nav>
        </div>
      </header>

      {/* Content */}
      <main className="p-6 max-w-[1400px] mx-auto">
        {loading && <LoadingSkeleton />}

        {error && (
          <div className="rounded-xl p-6 border border-red-500/30 bg-red-500/10 text-red-400 text-sm">
            Error loading data: {error}
          </div>
        )}

        {data && !loading && (
          <ErrorBoundary>
            <div role="tabpanel">
              {tab === "overview" && (
                <Overview
                  posts={filteredPosts}
                  dailyMetrics={filteredDaily}
                  alerts={filteredAlerts}
                  weeklySummaries={filteredSummaries}
                  prevPosts={comparisonPosts}
                  prevDailyMetrics={comparisonDaily}
                />
              )}
              {tab === "content" && <ContentAnalysis posts={filteredPosts} />}
              {tab === "audience" && (
                <AudienceGrowth
                  posts={filteredPosts}
                  dailyMetrics={filteredDaily}
                />
              )}
              {tab === "compare" && (
                <PlatformCompare
                  posts={filteredPosts}
                  dailyMetrics={filteredDaily}
                />
              )}
              {tab === "competitors" && (
                <CompetitorInsights
                  records={competitorRecords}
                  loading={competitorLoading}
                  error={competitorError}
                />
              )}
            </div>
          </ErrorBoundary>
        )}
      </main>

      <ChatBox />
    </div>
  );
}
