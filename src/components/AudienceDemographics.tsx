"use client";

import { useMemo } from "react";
import { Bar } from "react-chartjs-2";
import "@/lib/chartSetup";
import { CHART_COLORS } from "@/lib/chartSetup";
import ChartCard from "./ChartCard";
import AudienceMap from "./AudienceMap";
import InsightStrip from "./InsightStrip";
import { toAudienceDemographic, type AudienceDemographic } from "@/lib/types";
import type { AirtableRecord } from "@/lib/utils";

interface AudienceDemographicsProps {
  records: AirtableRecord[];
}

const BREAKDOWN_LABEL: Record<AudienceDemographic["breakdown"], string> = {
  age: "Age",
  gender: "Gender",
  country: "Country",
  city: "City",
};

const AUDIENCE_TYPE_LABEL: Record<AudienceDemographic["audienceType"], string> =
  {
    follower: "Followers",
    engaged: "Engaged (last 30d)",
  };

/**
 * Returns the most recent snapshot date present in the records, or empty string.
 */
function latestSnapshotDate(records: AudienceDemographic[]): string {
  if (records.length === 0) return "";
  return records.reduce((max, r) =>
    r.snapshotDate > max ? r.snapshotDate : max,
    records[0].snapshotDate,
  );
}

/**
 * Filters demographics to (snapshotDate, audienceType, breakdown), sorted by
 * value descending. For city breakdowns, also truncates to top 10 since the
 * API returns up to 45 cities.
 */
function bucketsFor(
  records: AudienceDemographic[],
  snapshotDate: string,
  audienceType: AudienceDemographic["audienceType"],
  breakdown: AudienceDemographic["breakdown"],
): AudienceDemographic[] {
  const filtered = records.filter(
    (r) =>
      r.snapshotDate === snapshotDate &&
      r.audienceType === audienceType &&
      r.breakdown === breakdown,
  );
  filtered.sort((a, b) => b.value - a.value);
  return breakdown === "city" ? filtered.slice(0, 10) : filtered;
}

interface BreakdownChartProps {
  breakdown: AudienceDemographic["breakdown"];
  followerBuckets: AudienceDemographic[];
  engagedBuckets: AudienceDemographic[];
}

function BreakdownChart({
  breakdown,
  followerBuckets,
  engagedBuckets,
}: BreakdownChartProps) {
  // Build a unified bucket ordering driven by follower data (the source of
  // truth for "who is in the audience"), then look up engaged values into
  // the same bucket positions. Engaged data lights up automatically when
  // Meta starts returning it (account currently below 100-engagement threshold).
  const labels = followerBuckets.map((b) => b.bucket);
  const followerTotal = followerBuckets.reduce((s, b) => s + b.value, 0);
  const engagedTotal = engagedBuckets.reduce((s, b) => s + b.value, 0);

  const engagedByBucket = new Map(engagedBuckets.map((b) => [b.bucket, b.value]));
  const engagedValues = labels.map((l) => engagedByBucket.get(l) ?? 0);

  const data = {
    labels,
    datasets: [
      {
        label: "Followers",
        data: followerBuckets.map((b) => b.value),
        backgroundColor: CHART_COLORS.blue,
        borderRadius: 4,
      },
      {
        label: "Engaged (30d)",
        data: engagedValues,
        backgroundColor: CHART_COLORS.amber,
        borderRadius: 4,
      },
    ],
  };

  const options = {
    indexAxis: "y" as const,
    responsive: true,
    maintainAspectRatio: false,
    plugins: {
      legend: {
        display: true,
        position: "top" as const,
        align: "end" as const,
        labels: {
          color: CHART_COLORS.muted,
          font: { size: 10 },
          boxWidth: 10,
          boxHeight: 10,
          padding: 8,
        },
      },
      tooltip: {
        backgroundColor: "#1e2230",
        titleColor: CHART_COLORS.white,
        bodyColor: CHART_COLORS.muted,
        borderColor: CHART_COLORS.grid,
        borderWidth: 1,
        callbacks: {
          // Append % of audience to each tooltip line.
          label: (ctx: {
            dataset: { label?: string };
            parsed: { x: number | null };
          }) => {
            const total =
              ctx.dataset.label === "Followers" ? followerTotal : engagedTotal;
            const v = ctx.parsed.x ?? 0;
            const pct = total > 0 ? ((v / total) * 100).toFixed(1) : "0";
            return `${ctx.dataset.label}: ${v.toLocaleString()} (${pct}%)`;
          },
        },
      },
    },
    scales: {
      x: {
        ticks: { color: CHART_COLORS.muted, font: { size: 11 } },
        grid: { color: CHART_COLORS.grid },
      },
      y: {
        ticks: { color: CHART_COLORS.muted, font: { size: 11 } },
        grid: { color: "transparent" },
      },
    },
  };

  if (followerBuckets.length === 0) {
    return (
      <div
        className="text-xs text-center pt-12"
        style={{ color: "var(--text-secondary)" }}
      >
        No {BREAKDOWN_LABEL[breakdown].toLowerCase()} data for this snapshot.
      </div>
    );
  }

  return <Bar data={data} options={options} />;
}

export default function AudienceDemographics({
  records,
}: AudienceDemographicsProps) {
  const demographics = useMemo(
    () => records.map(toAudienceDemographic),
    [records],
  );

  const latestDate = useMemo(
    () => latestSnapshotDate(demographics),
    [demographics],
  );

  // Compute both audience types — follower is the populated one; engaged
  // requires ≥100 engagement events, often empty for small accounts.
  const hasEngaged = useMemo(
    () =>
      demographics.some(
        (r) => r.audienceType === "engaged" && r.snapshotDate === latestDate,
      ),
    [demographics, latestDate],
  );

  if (demographics.length === 0) {
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
          Instagram Audience Demographics
        </h3>
        <p
          className="text-xs"
          style={{ color: "var(--text-secondary)" }}
        >
          No demographics data yet. The Social Data Refresher fetches this
          daily — wait for the next scheduled run.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex items-baseline justify-between">
        <h3
          className="text-sm font-medium"
          style={{ color: "var(--text-secondary)" }}
        >
          Instagram Audience Demographics
        </h3>
        <span
          className="text-xs"
          style={{ color: "var(--text-secondary)" }}
        >
          Snapshot: {latestDate} · {AUDIENCE_TYPE_LABEL.follower}
          {!hasEngaged && (
            <>
              {" "}· Engaged-audience data unavailable (account below Meta's
              100-engagement reporting threshold)
            </>
          )}
        </span>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {(["age", "gender", "city"] as const).map((breakdown) => {
          const followerBuckets = bucketsFor(
            demographics,
            latestDate,
            "follower",
            breakdown,
          );
          const engagedBuckets = bucketsFor(
            demographics,
            latestDate,
            "engaged",
            breakdown,
          );
          return (
            <ChartCard
              key={breakdown}
              title={BREAKDOWN_LABEL[breakdown]}
              height="280px"
              tooltip={
                breakdown === "city"
                  ? "Top 10 cities by follower count. API returns up to 45."
                  : "Followers (blue) vs Engaged audience (amber). Engaged lights up once Meta's 100-engagement threshold is met."
              }
            >
              <BreakdownChart
                breakdown={breakdown}
                followerBuckets={followerBuckets}
                engagedBuckets={engagedBuckets}
              />
              <InsightLine
                breakdown={breakdown}
                followerBuckets={followerBuckets}
                engagedBuckets={engagedBuckets}
              />
            </ChartCard>
          );
        })}
      </div>

      {/* Country view — world map instead of a bar chart so geo distribution
          is glanceable, with the top countries also listed below. */}
      <CountryView
        followers={bucketsFor(demographics, latestDate, "follower", "country")}
      />
    </div>
  );
}

/**
 * One-line auto-derived insight printed under each chart. Computed
 * directly from the data rather than against external benchmarks since
 * we don't have those.
 */
function InsightLine({
  breakdown,
  followerBuckets,
  engagedBuckets,
}: {
  breakdown: AudienceDemographic["breakdown"];
  followerBuckets: AudienceDemographic[];
  engagedBuckets: AudienceDemographic[];
}) {
  const text = useMemo(() => {
    const followerTotal = followerBuckets.reduce((s, b) => s + b.value, 0);
    if (followerTotal === 0) return "";
    const top = [...followerBuckets].sort((a, b) => b.value - a.value)[0];
    if (!top) return "";
    const topPct = ((top.value / followerTotal) * 100).toFixed(0);

    // Engaged-vs-follower skew callout when engaged data is present.
    let skew = "";
    if (engagedBuckets.length > 0) {
      const engagedTotal = engagedBuckets.reduce((s, b) => s + b.value, 0);
      if (engagedTotal > 0) {
        const engagedTop = [...engagedBuckets].sort(
          (a, b) => b.value - a.value,
        )[0];
        if (engagedTop && engagedTop.bucket !== top.bucket) {
          const engagedTopPct = (
            (engagedTop.value / engagedTotal) *
            100
          ).toFixed(0);
          skew = ` Engaged audience skews ${engagedTop.bucket} (${engagedTopPct}%).`;
        }
      }
    }

    const noun =
      breakdown === "age"
        ? "age bracket"
        : breakdown === "gender"
          ? "gender"
          : breakdown === "city"
            ? "city"
            : "country";
    return `Top ${noun}: ${top.bucket} (${topPct}% of followers).${skew}`;
  }, [breakdown, followerBuckets, engagedBuckets]);

  if (!text) return null;
  return (
    <p
      className="text-[11px] mt-2 leading-snug"
      style={{ color: "var(--text-secondary)" }}
    >
      {text}
    </p>
  );
}

/** World choropleth + top-countries list, replacing the old country bar. */
function CountryView({ followers }: { followers: AudienceDemographic[] }) {
  const total = useMemo(
    () => followers.reduce((s, b) => s + b.value, 0),
    [followers],
  );
  const countryCounts = useMemo(() => {
    const out: Record<string, number> = {};
    for (const b of followers) out[b.bucket] = b.value;
    return out;
  }, [followers]);
  const top = useMemo(
    () => [...followers].sort((a, b) => b.value - a.value).slice(0, 5),
    [followers],
  );

  return (
    <div
      className="rounded-xl p-4 space-y-3"
      style={{
        background: "var(--bg-card)",
        border: "1px solid var(--border)",
      }}
    >
      <div className="flex items-center justify-between">
        <h4
          className="text-sm font-medium"
          style={{ color: "var(--text-primary)" }}
        >
          Country
        </h4>
        <span
          className="text-[11px]"
          style={{ color: "var(--text-secondary)" }}
        >
          {total.toLocaleString()} followers across {followers.length} countries
        </span>
      </div>
      {top.length > 0 && total > 0 && (() => {
        const leader = top[0];
        const top5Sum = top.reduce((s, b) => s + b.value, 0);
        const leaderPct = (leader.value / total) * 100;
        const top5Pct = (top5Sum / total) * 100;
        return (
          <InsightStrip
            headline={
              <>
                <strong>{leader.bucket}</strong> leads at{" "}
                <strong>{leaderPct.toFixed(1)}%</strong> ·{" "}
                top 5 = <strong>{top5Pct.toFixed(0)}%</strong> of audience
                {" · "}
                <span style={{ color: "var(--text-secondary)" }}>
                  spread across {followers.length} countries
                </span>
              </>
            }
            extra={
              <span>
                Snapshot only — period-over-period mover analysis pending
                historical demographic backfill.
              </span>
            }
          />
        );
      })()}
      <AudienceMap
        countryCounts={countryCounts}
        total={total}
        height={300}
      />
      <div className="flex flex-wrap gap-2 text-xs">
        {top.map((b, i) => {
          const pct = total > 0 ? ((b.value / total) * 100).toFixed(1) : "0";
          return (
            <span
              key={b.bucket}
              className="px-2 py-1 rounded"
              style={{
                background:
                  i === 0
                    ? "rgba(1, 113, 228, 0.2)"
                    : "var(--bg-secondary)",
                border: "1px solid var(--border)",
                color: "var(--text-primary)",
              }}
            >
              <span className="opacity-60">#{i + 1}</span> {b.bucket}{" "}
              <span style={{ color: "var(--text-secondary)" }}>
                {b.value.toLocaleString()} ({pct}%)
              </span>
            </span>
          );
        })}
      </div>
    </div>
  );
}
