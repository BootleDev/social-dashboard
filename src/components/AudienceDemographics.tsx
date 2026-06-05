"use client";

import { useMemo } from "react";
import { Bar } from "react-chartjs-2";
import "@/lib/chartSetup";
import { useChartTheme } from "@/lib/useChartTheme";
import ChartCard from "./ChartCard";
import StatsPanel from "./StatsPanel";
import { describe } from "@/lib/stats";
import { toAudienceDemographic, type AudienceDemographic } from "@/lib/types";
import { rollupCountries } from "@/lib/countryRollup";
import type { AirtableRecord } from "@/lib/utils";

/**
 * Top markets to list individually before folding the long tail into a single
 * "other" row (WEBDEV-182 item 13). The raw list runs to ~57 countries; past a
 * dozen they are thin slices that bury the meaningful concentration.
 */
const COUNTRY_TOP_N = 12;

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
  const { colors } = useChartTheme();

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
        backgroundColor: colors.series[0],
        borderRadius: 4,
      },
      {
        label: "Engaged (30d)",
        data: engagedValues,
        backgroundColor: colors.series[1],
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
          color: colors.axis,
          font: { size: 10 },
          boxWidth: 10,
          boxHeight: 10,
          padding: 8,
        },
      },
      tooltip: {
        backgroundColor: colors.tooltipBg,
        titleColor: colors.tooltipText,
        bodyColor: colors.axis,
        borderColor: colors.grid,
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
        ticks: { color: colors.axis, font: { size: 11 } },
        grid: { color: colors.grid },
      },
      y: {
        ticks: { color: colors.axis, font: { size: 11 } },
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
          const tooltipText =
            breakdown === "age"
              ? "Distribution of your Instagram follower base across age brackets (13-17, 18-24, 25-34, 35-44, 45-54, 55-64, 65+). Blue = total follower count in each bracket. Amber = Engaged subset (followers who liked/commented/saved in the last 30 days). The Engaged series only lights up once Meta's 100-engagement reporting threshold is met across the account."
              : breakdown === "gender"
                ? "Distribution of your Instagram follower base across gender categories Meta exposes (M / F / U for unknown). Same Follower vs Engaged split as Age. Note: Meta only returns binary categories — non-binary identities fall into U."
                : "Top 10 cities by follower count — Meta's audience demographics API returns up to ~45 cities, ranked by count. Use this to spot geographic concentration that maps to local marketing or partnerships. No Engaged series at city granularity (Meta only exposes Engaged for age/gender/country).";
          return (
            <ChartCard
              key={breakdown}
              title={BREAKDOWN_LABEL[breakdown]}
              height="280px"
              tooltip={tooltipText}
              headerAction={
                <StatsPanel
                  stats={describe(followerBuckets.map((b) => b.value))}
                  format={(v) =>
                    Math.abs(v) >= 1000 ? v.toFixed(0) : v.toFixed(1)
                  }
                  context={`Follower-count distribution across ${BREAKDOWN_LABEL[breakdown].toLowerCase()} buckets`}
                />
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

/** Ranked country list with bar viz. Replaces the world map (dropped 2026-05-28
 *  with react-simple-maps removal — incompatible peer-dep with React 19). */
function CountryView({ followers }: { followers: AudienceDemographic[] }) {
  const total = useMemo(
    () => followers.reduce((s, b) => s + b.value, 0),
    [followers],
  );
  const ranked = useMemo(
    () => [...followers].sort((a, b) => b.value - a.value),
    [followers],
  );
  const max = ranked[0]?.value ?? 0;
  // Cap the listed countries and fold the long tail into a single "other" row.
  const { shown, other } = useMemo(
    () => rollupCountries(followers, COUNTRY_TOP_N),
    [followers],
  );

  // Use Intl.DisplayNames (no dep) to render readable country names.
  const displayNames =
    typeof Intl !== "undefined" && typeof Intl.DisplayNames === "function"
      ? new Intl.DisplayNames(["en"], { type: "region" })
      : null;
  const countryName = (alpha2: string): string => {
    if (!displayNames) return alpha2;
    try {
      return displayNames.of(alpha2.toUpperCase()) ?? alpha2;
    } catch {
      return alpha2;
    }
  };

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
      <div className="space-y-1.5">
        {shown.map((b, i) => {
          const pct = total > 0 ? (b.value / total) * 100 : 0;
          const barWidth = max > 0 ? (b.value / max) * 100 : 0;
          return (
            <div
              key={b.bucket}
              className="grid items-center gap-2 text-xs"
              style={{ gridTemplateColumns: "20px 1fr 80px 60px" }}
            >
              <span
                className="text-[10px] text-right tabular-nums"
                style={{ color: "var(--text-secondary)" }}
              >
                {i + 1}
              </span>
              <div
                className="truncate"
                style={{ color: "var(--text-primary)" }}
                title={countryName(b.bucket)}
              >
                {countryName(b.bucket)}
              </div>
              <div
                className="relative h-2 rounded overflow-hidden"
                style={{ background: "var(--bg-secondary)" }}
              >
                <div
                  className="absolute inset-y-0 left-0 rounded"
                  style={{
                    width: `${barWidth}%`,
                    background: "var(--brand)",
                  }}
                />
              </div>
              <div
                className="text-right tabular-nums text-[11px]"
                style={{ color: "var(--text-secondary)" }}
              >
                {b.value.toLocaleString()}{" "}
                <span style={{ color: "var(--text-secondary)", opacity: 0.7 }}>
                  ({pct.toFixed(1)}%)
                </span>
              </div>
            </div>
          );
        })}

        {/* Folded long tail — one row standing in for every country past the
            top N, with its follower total preserved (WEBDEV-182 item 13). */}
        {other && (
          <div
            className="grid items-center gap-2 text-xs pt-1"
            style={{
              gridTemplateColumns: "20px 1fr 80px 60px",
              borderTop: "1px solid var(--border)",
            }}
          >
            <span />
            <div
              className="truncate italic"
              style={{ color: "var(--text-secondary)" }}
            >
              Other ({other.countryCount} countries)
            </div>
            <div
              className="relative h-2 rounded overflow-hidden"
              style={{ background: "var(--bg-secondary)" }}
            >
              <div
                className="absolute inset-y-0 left-0 rounded"
                style={{
                  width: `${max > 0 ? (other.value / max) * 100 : 0}%`,
                  background: "var(--text-secondary)",
                  opacity: 0.5,
                }}
              />
            </div>
            <div
              className="text-right tabular-nums text-[11px]"
              style={{ color: "var(--text-secondary)" }}
            >
              {other.value.toLocaleString()}{" "}
              <span style={{ color: "var(--text-secondary)", opacity: 0.7 }}>
                ({total > 0 ? ((other.value / total) * 100).toFixed(1) : "0"}%)
              </span>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
