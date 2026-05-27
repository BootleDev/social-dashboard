"use client";

import { useMemo } from "react";
import { Line, Bar } from "react-chartjs-2";
import "@/lib/chartSetup";
import { CHART_COLORS, defaultOptions, lineChartOptions } from "@/lib/chartSetup";
import { getPlatformConfig } from "@/lib/platforms";
import KPICard from "./KPICard";
import ChartCard from "./ChartCard";
import InsightStrip from "./InsightStrip";
import {
  num,
  formatNumber,
  groupByPlatform,
  getPlatformKeys,
  sumField,
  buildUnifiedDates,
  alignToDateArray,
  trimTrailingZeroDay,
} from "@/lib/utils";
import { describe, pctChange, formatPct, trendVerdict } from "@/lib/stats";
import type { AirtableRecord } from "@/lib/utils";

interface AudienceGrowthProps {
  posts: AirtableRecord[];
  dailyMetrics: AirtableRecord[];
}

export default function AudienceGrowth({
  posts,
  dailyMetrics,
}: AudienceGrowthProps) {
  const platformMap = useMemo(
    () => groupByPlatform(dailyMetrics),
    [dailyMetrics],
  );
  const platformKeys = useMemo(
    () => getPlatformKeys(dailyMetrics),
    [dailyMetrics],
  );

  // Unified date array — trim trailing day if no platform reported data yet
  // (Meta cron often hasn't filled today's values when we read).
  const allDates = useMemo(
    () => {
      const initial = buildUnifiedDates(
        ...platformKeys.map((k) => platformMap.get(k) ?? []),
      );
      // For each platform, align Followers to the initial array, then check
      // if every platform's trailing value is 0/null.
      const series = platformKeys.map((k) =>
        alignToDateArray(platformMap.get(k) ?? [], initial, "Followers"),
      );
      return trimTrailingZeroDay(initial, series);
    },
    [platformKeys, platformMap],
  );

  // Date before which IG follower values are known to be corrupted by the
  // upsert-stomp bug fixed 2026-05-26. Pre-this-date values cannot be
  // backfilled (Meta's API caps at 30 days), so we mask them with null so
  // chart.js skips them rather than rendering inflated numbers.
  const IG_CORRUPT_BEFORE = "2026-04-27";

  // Follower growth with daily change
  const followerGrowthData = useMemo(() => {
    const labels = allDates.map((d) => d.slice(5));

    const followerDatasets = platformKeys.map((key) => {
      const config = getPlatformConfig(key);
      const metrics = platformMap.get(key) ?? [];
      const raw = alignToDateArray(metrics, allDates, "Followers");
      // Mask IG corrupted historical values.
      const data =
        key === "instagram"
          ? raw.map((v, i) =>
              allDates[i] && allDates[i] < IG_CORRUPT_BEFORE ? null : v,
            )
          : raw;
      return {
        label: `${config.label} Followers`,
        data,
        borderColor: config.color,
        backgroundColor: config.colorFill,
        fill: false,
        tension: 0.3,
        pointRadius: 0,
        yAxisID: "y",
        spanGaps: false,
      };
    });

    // Daily gain from first platform that has data (secondary axis)
    const firstKey = platformKeys[0];
    const firstMetrics = firstKey ? (platformMap.get(firstKey) ?? []) : [];
    const rawGain = firstKey
      ? alignToDateArray(firstMetrics, allDates, "Followers Gained")
      : [];
    const maskedGain =
      firstKey === "instagram"
        ? rawGain.map((v, i) =>
            allDates[i] && allDates[i] < IG_CORRUPT_BEFORE ? null : v,
          )
        : rawGain;
    const gainDataset =
      firstKey && firstMetrics.length > 0
        ? [
            {
              label: `${getPlatformConfig(firstKey).label} Daily Gain`,
              data: maskedGain,
              borderColor: CHART_COLORS.green,
              backgroundColor: CHART_COLORS.green + "20",
              fill: true,
              tension: 0.3,
              pointRadius: 0,
              yAxisID: "y1",
              borderDash: [4, 2],
            },
          ]
        : [];

    return {
      labels,
      datasets: [...followerDatasets, ...gainDataset],
    };
  }, [platformKeys, platformMap, allDates]);

  const followerGrowthOptions = {
    ...lineChartOptions,
    scales: {
      ...lineChartOptions.scales,
      y: {
        ...lineChartOptions.scales.y,
        position: "left" as const,
        beginAtZero: false,
        title: { display: true, text: "Followers", color: CHART_COLORS.muted },
      },
      y1: {
        position: "right" as const,
        ticks: { color: CHART_COLORS.muted, font: { size: 10 } },
        grid: { drawOnChartArea: false },
        title: { display: true, text: "Daily Gain", color: CHART_COLORS.muted },
      },
    },
  };

  // Reach trend — dynamic per platform
  const reachData = useMemo(() => {
    const labels = allDates.map((d) => d.slice(5));

    return {
      labels,
      datasets: platformKeys.map((key) => {
        const config = getPlatformConfig(key);
        const metrics = platformMap.get(key) ?? [];
        return {
          label: `${config.label} Reach`,
          data: alignToDateArray(metrics, allDates, "Reach"),
          borderColor: config.color,
          tension: 0.3,
          pointRadius: 0,
        };
      }),
    };
  }, [platformKeys, platformMap, allDates]);

  // Profile views trend — dynamic per platform
  const profileViewsData = useMemo(() => {
    const labels = allDates.map((d) => d.slice(5));

    return {
      labels,
      datasets: platformKeys.map((key) => {
        const config = getPlatformConfig(key);
        const metrics = platformMap.get(key) ?? [];
        return {
          label: `${config.label} Profile Views`,
          data: alignToDateArray(metrics, allDates, "Profile Views"),
          backgroundColor: config.color + "60",
          borderColor: config.color,
          borderWidth: 1,
        };
      }),
    };
  }, [platformKeys, platformMap, allDates]);

  // Follower growth insight — accelerating / flat / decelerating verdict
  // computed per platform from masked daily gain series. Uses the last 7
  // days vs prior 7 days within the current date range; gracefully falls
  // back to "first week of data" framing when <14 days are available.
  const followerInsight = useMemo(() => {
    const perPlatform = platformKeys
      .map((key) => {
        const config = getPlatformConfig(key);
        const metrics = platformMap.get(key) ?? [];
        const rawGain = alignToDateArray(metrics, allDates, "Followers Gained");
        const gain =
          key === "instagram"
            ? rawGain.map((v, i) =>
                allDates[i] && allDates[i] < IG_CORRUPT_BEFORE ? 0 : v,
              )
            : rawGain;
        const validIdx = gain
          .map((v, i) => ({ v, i }))
          .filter(({ i }) =>
            key === "instagram"
              ? allDates[i] && allDates[i] >= IG_CORRUPT_BEFORE
              : true,
          );
        const periodGain = validIdx.reduce((sum, { v }) => sum + v, 0);
        const tail = validIdx.slice(-7).reduce((s, { v }) => s + v, 0);
        const prior = validIdx
          .slice(-14, -7)
          .reduce((s, { v }) => s + v, 0);
        const delta = pctChange(prior, tail);
        const verdict = trendVerdict(delta);
        return {
          key,
          label: config.label,
          color: config.color,
          periodGain,
          last7: tail,
          prior7: prior,
          delta,
          verdict,
          n: validIdx.length,
        };
      })
      .filter((p) => p.n >= 1);
    return perPlatform;
  }, [platformKeys, platformMap, allDates]);

  const followerInsightHeadline = useMemo(() => {
    if (followerInsight.length === 0) return null;
    // Build one short clause per platform; rank by abs(delta) so the most
    // notable mover anchors the sentence.
    const ranked = [...followerInsight].sort((a, b) => {
      const da = a.delta === undefined ? -1 : Math.abs(a.delta);
      const db = b.delta === undefined ? -1 : Math.abs(b.delta);
      return db - da;
    });
    return (
      <>
        {ranked.map((p, i) => {
          const sign = (p.periodGain ?? 0) >= 0 ? "+" : "";
          const color =
            p.verdict === "accelerating"
              ? "var(--success, #2ecc71)"
              : p.verdict === "decelerating"
                ? "var(--danger, #e74c3c)"
                : "var(--text-secondary)";
          const verdictWord =
            p.verdict === "accelerating"
              ? "accelerating"
              : p.verdict === "decelerating"
                ? "decelerating"
                : "flat";
          return (
            <span key={p.key}>
              {i > 0 && <span style={{ color: "var(--text-secondary)" }}> · </span>}
              <strong>{p.label}</strong>{" "}
              {sign}
              {formatNumber(p.periodGain)} in period
              {p.delta !== undefined && (
                <>
                  {", "}
                  <span style={{ color }}>
                    {verdictWord} ({formatPct(p.delta)} vs prior 7d)
                  </span>
                </>
              )}
            </span>
          );
        })}
      </>
    );
  }, [followerInsight]);

  // Reach insight — leader + period-over-period delta if comparison data present.
  // Conservative: only computes pp if the same metric exists in both halves.
  const reachInsight = useMemo(() => {
    const perPlatform = platformKeys.map((key) => {
      const config = getPlatformConfig(key);
      const metrics = platformMap.get(key) ?? [];
      const series = alignToDateArray(metrics, allDates, "Reach");
      const total = series.reduce((s, v) => s + v, 0);
      const half = Math.floor(series.length / 2);
      const firstHalf = series.slice(0, half).reduce((s, v) => s + v, 0);
      const secondHalf = series.slice(half).reduce((s, v) => s + v, 0);
      const delta = pctChange(firstHalf, secondHalf);
      return { key, label: config.label, total, delta };
    });
    const ranked = [...perPlatform].sort((a, b) => b.total - a.total);
    const leader = ranked[0];
    const top3Stats = describe(ranked.map((p) => p.total));
    return { leader, ranked, stats: top3Stats };
  }, [platformKeys, platformMap, allDates]);

  // Profile views insight — total + best-day callout.
  const profileViewsInsight = useMemo(() => {
    let bestDate = "";
    let bestVal = 0;
    let total = 0;
    const allVals: number[] = [];
    for (const key of platformKeys) {
      const metrics = platformMap.get(key) ?? [];
      const series = alignToDateArray(metrics, allDates, "Profile Views");
      series.forEach((v, i) => {
        allVals.push(v);
        total += v;
        if (v > bestVal) {
          bestVal = v;
          bestDate = allDates[i] ?? "";
        }
      });
    }
    return { total, bestDate, bestVal, stats: describe(allVals) };
  }, [platformKeys, platformMap, allDates]);

  // Per-platform KPIs
  const platformKPIs = useMemo(
    () =>
      platformKeys.map((key) => {
        const metrics = platformMap.get(key) ?? [];
        const latest = metrics[0];
        const followers = latest ? num(latest.fields["Followers"]) : 0;
        const growth = sumField(metrics, "Followers Gained");
        return { key, followers, growth };
      }),
    [platformKeys, platformMap],
  );

  const totalReach = sumField(dailyMetrics, "Reach");
  const totalWebClicks = sumField(dailyMetrics, "Website Clicks");
  // Website Clicks is no longer written by Meta Graph API v22.0 (closest field
  // bundles website + email + phone + address taps and isn't a substitute).
  // Detect "field never populated for this date range" so we can surface "—"
  // instead of a misleading 0. Real per-content website attribution is coming
  // from GA4 referrer data in a separate ticket.
  const hasWebsiteClickData = dailyMetrics.some((r) => {
    const v = r.fields["Website Clicks"];
    return v !== undefined && v !== null;
  });

  if (dailyMetrics.length === 0) {
    return (
      <div
        className="rounded-xl p-8 text-center"
        style={{
          background: "var(--bg-card)",
          border: "1px solid var(--border)",
        }}
      >
        <p className="text-sm" style={{ color: "var(--text-secondary)" }}>
          No audience data for this period. Try expanding the date range.
        </p>
      </div>
    );
  }

  // Dynamic grid: 2 cols minimum, scale up with platforms
  const gridCols =
    platformKPIs.length <= 2
      ? "grid-cols-2 sm:grid-cols-4"
      : "grid-cols-2 sm:grid-cols-3 lg:grid-cols-5";

  return (
    <div className="space-y-6">
      {/* KPI Row */}
      <div className={`grid ${gridCols} gap-3`}>
        {platformKPIs.map(({ key, followers, growth }) => {
          // MARKETING-19 Fix 5: Pinterest-specific caption explaining API limitations.
          // Per-pin reach is not exposed by Pinterest's API; impressions + saves
          // ARE available. Low absolute numbers at current 5-follower scale are
          // expected, not a tracking failure.
          const pinterestTip =
            key === "pinterest"
              ? "Pinterest's API doesn't expose per-pin reach (use Impressions instead). Low absolute numbers reflect current account scale (~5 followers), not a tracking gap."
              : undefined;
          return (
            <KPICard
              key={key}
              title={`${getPlatformConfig(key).label} Followers`}
              value={formatNumber(followers)}
              subtitle={`+${growth} in period`}
              platformLabel={key}
              tooltip={pinterestTip}
            />
          );
        })}
        <KPICard title="Total Reach" value={formatNumber(totalReach)} />
        <KPICard
          title="Website Clicks"
          value={hasWebsiteClickData ? formatNumber(totalWebClicks) : "—"}
          tooltip="Not tracked at the platform level in Meta Graph API v22.0. Real per-content website attribution is pending GA4 referrer integration (separate ticket)."
        />
      </div>

      {/* Follower Growth Chart */}
      {followerInsightHeadline && (
        <InsightStrip headline={followerInsightHeadline} />
      )}
      <ChartCard title="Follower Growth (Daily)" height="350px">
        <Line data={followerGrowthData} options={followerGrowthOptions} />
      </ChartCard>
      <p
        className="text-[10px] -mt-2"
        style={{ color: "var(--text-secondary)" }}
      >
        Note: Instagram follower history before 2026-04-27 is hidden — those
        values were corrupted by an upsert bug and Meta&apos;s API only retains
        30 days of daily history, so they cannot be backfilled accurately.
        Daily values from 2026-04-27 onward are accurate.
      </p>

      {/* Reach + Profile Views */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <div>
          {reachInsight.leader && reachInsight.leader.total > 0 && (
            <InsightStrip
              headline={
                <>
                  <strong>{reachInsight.leader.label}</strong> leads reach:{" "}
                  {formatNumber(reachInsight.leader.total)} in period
                  {reachInsight.leader.delta !== undefined && (
                    <>
                      {", "}
                      <span
                        style={{
                          color:
                            reachInsight.leader.delta > 0
                              ? "var(--success, #2ecc71)"
                              : "var(--danger, #e74c3c)",
                        }}
                      >
                        {formatPct(reachInsight.leader.delta)} second half vs first
                      </span>
                    </>
                  )}
                </>
              }
              stats={reachInsight.stats}
              statsUnit=""
              formatStat={(v) => formatNumber(v)}
            />
          )}
          <ChartCard title="Daily Reach by Platform">
            <Line data={reachData} options={lineChartOptions} />
          </ChartCard>
        </div>
        <div>
          {profileViewsInsight.total > 0 && (
            <InsightStrip
              headline={
                <>
                  <strong>{formatNumber(profileViewsInsight.total)}</strong>{" "}
                  profile views in period
                  {profileViewsInsight.bestDate && profileViewsInsight.bestVal > 0 && (
                    <>
                      {" · best day "}
                      <strong>{profileViewsInsight.bestDate}</strong>{" "}
                      ({formatNumber(profileViewsInsight.bestVal)})
                    </>
                  )}
                </>
              }
              stats={profileViewsInsight.stats}
              formatStat={(v) => formatNumber(v)}
            />
          )}
          <ChartCard title="Profile / Page Views">
            <Bar data={profileViewsData} options={defaultOptions} />
          </ChartCard>
        </div>
      </div>

      {/* Follows from Posts */}
      {sumField(posts, "Follows From Post") > 0 && (
        <div
          className="rounded-xl p-5"
          style={{
            background: "var(--bg-card)",
            border: "1px solid var(--border)",
          }}
        >
          <h3
            className="text-sm font-medium mb-2"
            style={{ color: "var(--text-secondary)" }}
          >
            Follower Sources from Posts
          </h3>
          <p className="text-2xl font-bold">
            {formatNumber(sumField(posts, "Follows From Post"))}
          </p>
          <p
            className="text-xs mt-1"
            style={{ color: "var(--text-secondary)" }}
          >
            Total new followers attributed to individual posts in this period
          </p>
        </div>
      )}
    </div>
  );
}
