"use client";

import { useState, useEffect, useMemo, useCallback } from "react";
import Overview from "@/components/Overview";
import ContentAnalysis from "@/components/ContentAnalysis";
import AudienceGrowth from "@/components/AudienceGrowth";
import PlatformCompare from "@/components/PlatformCompare";
import DateRangeFilter from "@/components/DateRangeFilter";
import type { DateRange } from "@/components/DateRangeFilter";
import ChatBox from "@/components/ChatBox";
import { str } from "@/lib/utils";
import type { AirtableRecord } from "@/lib/utils";

type Tab = "overview" | "content" | "audience" | "compare";

interface DashboardData {
  posts: AirtableRecord[];
  dailyMetrics: AirtableRecord[];
  weeklySummaries: AirtableRecord[];
  alerts: AirtableRecord[];
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

  // Filter data by date range
  const filteredPosts = useMemo(
    () => (data ? filterByDateRange(data.posts, "Published At", dateRange) : []),
    [data, dateRange],
  );
  const filteredDaily = useMemo(
    () => (data ? filterByDateRange(data.dailyMetrics, "Date", dateRange) : []),
    [data, dateRange],
  );
  const filteredAlerts = useMemo(
    () => (data ? filterByDateRange(data.alerts, "Alert Date", dateRange) : []),
    [data, dateRange],
  );

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

  const tabs: { key: Tab; label: string }[] = [
    { key: "overview", label: "Overview" },
    { key: "content", label: "Content Analysis" },
    { key: "audience", label: "Audience & Growth" },
    { key: "compare", label: "Platform Compare" },
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
                  <span
                    className="inline-block w-1.5 h-1.5 rounded-full"
                    style={{ background: "#a855f7" }}
                    title={`Instagram`}
                  />
                  <span
                    className="inline-block w-1.5 h-1.5 rounded-full"
                    style={{ background: "#3b82f6" }}
                    title={`Facebook`}
                  />
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
                className="text-[10px] px-1.5 py-0.5 rounded transition-colors hover:bg-white/10"
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

          <nav
            className="flex gap-1 rounded-lg p-1"
            style={{ background: "var(--bg-secondary)" }}
          >
            {tabs.map((t) => (
              <button
                key={t.key}
                onClick={() => setTab(t.key)}
                className={`px-3 py-2 rounded-md text-xs font-medium transition-all ${
                  tab === t.key ? "text-white" : ""
                }`}
                style={{
                  background: tab === t.key ? "var(--accent-purple)" : "transparent",
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
        {loading && (
          <div className="flex items-center justify-center h-64">
            <div
              className="text-sm animate-pulse"
              style={{ color: "var(--text-secondary)" }}
            >
              Loading dashboard data...
            </div>
          </div>
        )}

        {error && (
          <div className="rounded-xl p-6 border border-red-500/30 bg-red-500/10 text-red-400 text-sm">
            Error loading data: {error}
          </div>
        )}

        {data && !loading && (
          <>
            {tab === "overview" && (
              <Overview
                posts={filteredPosts}
                dailyMetrics={filteredDaily}
                alerts={filteredAlerts}
              />
            )}
            {tab === "content" && (
              <ContentAnalysis posts={filteredPosts} />
            )}
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
          </>
        )}
      </main>

      <ChatBox />
    </div>
  );
}
