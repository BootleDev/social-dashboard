"use client";

import { useMemo } from "react";
import KPICard from "./KPICard";
import InfoTooltip from "./InfoTooltip";
import Sparkline from "./Sparkline";
import NeedsAttention from "./NeedsAttention";
import TrendCharts from "./TrendCharts";
import { glossaryFor } from "@/lib/metricGlossary";
import { getPlatformConfig } from "@/lib/platforms";
import {
  str,
  formatNumber,
  pctChange,
  sumField,
  recordReach,
  sumReach,
  hasRealReach,
  hasRealImpressions,
  latestFollowers,
  latestViews,
  groupByPlatform,
  getPlatformKeys,
  postEngagement,
} from "@/lib/utils";
import type { AirtableRecord } from "@/lib/utils";

/**
 * Sum platform-reported engagement across a set of posts. Delegates to the
 * shared postEngagement (which reads the authoritative `Engagement` field per
 * platform — see utils) so this never diverges from the single source of truth.
 */
function sumEngagement(records: AirtableRecord[]): number {
  return records.reduce((s, p) => s + postEngagement(p), 0);
}

/**
 * Build an ordered daily series for a post-level metric across the window, so
 * the north-star sparkline shows the trend WITHIN the period (not a flat line).
 * Days with no posts are 0 (a genuine zero — nothing was reaching/engaging that
 * day), which is the honest read for a post-level volume metric. Returns the
 * series oldest-first over the union of dates present in `posts`.
 */
function dailyPostSeries(
  posts: AirtableRecord[],
  metric: (records: AirtableRecord[]) => number,
): number[] {
  const byDay = new Map<string, AirtableRecord[]>();
  for (const p of posts) {
    const day = str(p.fields["Published At"]).split("T")[0];
    if (!day) continue;
    const bucket = byDay.get(day) ?? [];
    bucket.push(p);
    byDay.set(day, bucket);
  }
  const days = Array.from(byDay.keys()).sort((a, b) => a.localeCompare(b));
  return days.map((d) => metric(byDay.get(d) ?? []));
}

interface OverviewProps {
  posts: AirtableRecord[];
  /** Account-grain daily facts, date+platform filtered. */
  dailyMetrics: AirtableRecord[];
  /** Account facts WITHOUT date filtering (platform only) — IG 30-day reads. */
  periodFacts?: AirtableRecord[];
  alerts: AirtableRecord[];
  weeklySummaries: AirtableRecord[];
  prevPosts: AirtableRecord[];
  prevDailyMetrics: AirtableRecord[];
  onSelectPost: (post: AirtableRecord) => void;
}

/**
 * Overview — the 60-second executive read (rendered on the Pulse tab).
 *
 * Three stacked sections, zero raw tables:
 *   1. North-star strip — Total Reach + Total Engagement, big number, bold
 *      delta vs prior period, in-period sparkline.
 *   2. At-a-glance KPI row — five compact cards with per-platform share pills.
 *   3. Two side-by-side panels — per-platform account scorecards + the
 *      "Needs attention" triage list.
 *
 * The analytical layer (quality scores, trend charts, Top 5, IG 30-day tiles)
 * was lifted into the parked OverviewDeepDive component to keep this a scan.
 */
export default function Overview({
  posts,
  dailyMetrics,
  alerts,
  prevPosts,
  prevDailyMetrics,
  onSelectPost,
}: OverviewProps) {
  const platformMap = useMemo(
    () => groupByPlatform(dailyMetrics),
    [dailyMetrics],
  );
  const platformKeys = useMemo(
    () => getPlatformKeys(dailyMetrics),
    [dailyMetrics],
  );

  const model = useMemo(() => {
    // --- North-star: post-level Total Reach + Total Engagement -------------
    // Both are reported by every platform at the post level, so the sum is
    // genuinely comparable across IG/FB/Pinterest. recordReach() applies the
    // Pinterest impressions-as-reach substitution.
    const totalReach = posts.reduce((s, p) => s + recordReach(p), 0);
    const prevTotalReach = prevPosts.reduce((s, p) => s + recordReach(p), 0);
    const totalEngagement = sumEngagement(posts);
    const prevTotalEngagement = sumEngagement(prevPosts);

    const reachSeries = dailyPostSeries(posts, (r) =>
      r.reduce((s, p) => s + recordReach(p), 0),
    );
    const engagementSeries = dailyPostSeries(posts, sumEngagement);

    // --- KPI row ------------------------------------------------------------
    const totalFollowers = platformKeys.reduce((sum, key) => {
      const metrics = platformMap.get(key) ?? [];
      return sum + (latestFollowers(metrics) ?? 0);
    }, 0);
    const prevMap = groupByPlatform(prevDailyMetrics);
    const prevFollowers = platformKeys.reduce((sum, key) => {
      const metrics = prevMap.get(key) ?? [];
      return sum + (latestFollowers(metrics) ?? 0);
    }, 0);

    const postImpressions = sumField(posts, "Impressions");
    const prevPostImpressions = sumField(prevPosts, "Impressions");

    // Per-platform post buckets for the share pills.
    const postsByPlatform = new Map<string, AirtableRecord[]>();
    for (const p of posts) {
      const k = str(p.fields["Platform"]);
      if (!k) continue;
      if (!postsByPlatform.has(k)) postsByPlatform.set(k, []);
      postsByPlatform.get(k)!.push(p);
    }

    const breakdownFollowers = platformKeys.map((k) => ({
      platform: k,
      value: formatNumber(latestFollowers(platformMap.get(k) ?? []) ?? 0),
    }));
    const breakdownPostReach = Array.from(postsByPlatform.entries()).map(
      ([platform, ps]) => ({
        platform,
        value: formatNumber(ps.reduce((s, p) => s + recordReach(p), 0)),
      }),
    );
    const breakdownPostImpressions = Array.from(postsByPlatform.entries()).map(
      ([platform, ps]) => ({
        platform,
        value: formatNumber(sumField(ps, "Impressions")),
      }),
    );
    const breakdownPostEngagement = Array.from(postsByPlatform.entries()).map(
      ([platform, ps]) => ({
        platform,
        value: formatNumber(sumEngagement(ps)),
      }),
    );
    const breakdownPosts = Array.from(postsByPlatform.entries()).map(
      ([platform, ps]) => ({ platform, value: String(ps.length) }),
    );

    // --- Per-platform account scorecards -----------------------------------
    // Each platform shows only its OWN real account metrics; a metric the
    // platform doesn't publish renders as an em-dash (—), an intentional value.
    const accountScorecards = platformKeys.map((k) => {
      const m = platformMap.get(k) ?? [];
      const realReach = m.filter(hasRealReach);
      const realImpr = m.filter(hasRealImpressions);
      return {
        platform: k,
        followers: latestFollowers(m),
        reach: realReach.length > 0 ? sumReach(realReach) : null,
        impressions:
          realImpr.length > 0 ? sumField(realImpr, "Impressions") : null,
        // IG Views is a 30-day rolling aggregate on the NEWEST row only — taken
        // as a latest value, never summed across day-rows (WEBDEV-367).
        views: latestViews(m),
      };
    });

    return {
      totalReach,
      reachChange:
        prevTotalReach > 0 ? pctChange(totalReach, prevTotalReach) : undefined,
      reachNew: prevTotalReach === 0 && totalReach > 0,
      reachSeries,
      totalEngagement,
      engagementChange:
        prevTotalEngagement > 0
          ? pctChange(totalEngagement, prevTotalEngagement)
          : undefined,
      engagementNew: prevTotalEngagement === 0 && totalEngagement > 0,
      engagementSeries,
      totalFollowers,
      followersChange:
        prevFollowers > 0 ? pctChange(totalFollowers, prevFollowers) : undefined,
      followersNew: prevFollowers === 0 && totalFollowers > 0,
      postReach: totalReach,
      postReachChange:
        prevTotalReach > 0 ? pctChange(totalReach, prevTotalReach) : undefined,
      postReachNew: prevTotalReach === 0 && totalReach > 0,
      postImpressions,
      postImpressionsChange:
        prevPostImpressions > 0
          ? pctChange(postImpressions, prevPostImpressions)
          : undefined,
      postImpressionsNew: prevPostImpressions === 0 && postImpressions > 0,
      postsPublished: posts.length,
      breakdownFollowers,
      breakdownPostReach,
      breakdownPostImpressions,
      breakdownPostEngagement,
      breakdownPosts,
      accountScorecards,
    };
  }, [posts, prevPosts, dailyMetrics, prevDailyMetrics, platformKeys, platformMap]);

  if (posts.length === 0 && dailyMetrics.length === 0) {
    return (
      <div
        className="rounded-xl p-8 text-center"
        style={{
          background: "var(--bg-card)",
          border: "1px solid var(--border)",
        }}
      >
        <p className="text-sm" style={{ color: "var(--text-secondary)" }}>
          No data for this period. Try expanding the date range or check that
          the Social Data Refresher workflow is running.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-5">
      {/* ─── 1. NORTH-STAR STRIP ─────────────────────────────────────────── */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <NorthStarCard
          label="Total Reach"
          grainNote="post-level · summed across this window"
          value={formatNumber(model.totalReach)}
          change={model.reachChange}
          isNew={model.reachNew}
          series={model.reachSeries}
          tooltip={`${glossaryFor(
            "Reach",
          )} Summed across every post in the window, all platforms. Pinterest uses post impressions as its reach proxy. This is a POST-level total and intentionally differs from the account-level reach in the per-platform panel below — they measure different things and are not meant to match.`}
        />
        <NorthStarCard
          label="Total Engagement"
          grainNote="post-level · summed across this window"
          value={formatNumber(model.totalEngagement)}
          change={model.engagementChange}
          isNew={model.engagementNew}
          series={model.engagementSeries}
          tooltip="Likes, comments, saves and shares summed across every post in the window, all platforms."
        />
      </div>

      {/* ─── 2. AT-A-GLANCE KPI ROW ──────────────────────────────────────── */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3">
        <KPICard
          title="Total Followers"
          value={formatNumber(model.totalFollowers)}
          change={model.followersChange}
          isNew={model.followersNew}
          tooltip="Combined followers across all platforms (account-level)."
          breakdown={model.breakdownFollowers}
        />
        <KPICard
          title="Post Reach"
          value={formatNumber(model.postReach)}
          change={model.postReachChange}
          isNew={model.postReachNew}
          tooltip={`${glossaryFor(
            "Reach",
          )} Summed across every post in the window, all platforms (post-level). Pinterest uses post impressions as its reach proxy. Differs from the account-level reach in the per-platform panel — different grain, not an error.`}
          breakdown={model.breakdownPostReach}
        />
        <KPICard
          title="Post Impressions"
          value={formatNumber(model.postImpressions)}
          change={model.postImpressionsChange}
          isNew={model.postImpressionsNew}
          tooltip="Total impressions summed across every post in the window, all platforms."
          breakdown={model.breakdownPostImpressions}
        />
        <KPICard
          title="Total Engagement"
          value={formatNumber(model.totalEngagement)}
          change={model.engagementChange}
          isNew={model.engagementNew}
          tooltip="Likes + comments + saves + shares across every post in the window."
          breakdown={model.breakdownPostEngagement}
        />
        <KPICard
          title="Posts Published"
          value={String(model.postsPublished)}
          breakdown={model.breakdownPosts}
        />
      </div>

      {/* ─── 3. TWO SIDE-BY-SIDE PANELS ──────────────────────────────────── */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 items-stretch">
        {/* Account metrics by platform */}
        <div
          className="rounded-xl p-4"
          style={{
            background: "var(--bg-card)",
            border: "1px solid var(--border)",
          }}
        >
          <div className="flex items-center gap-1.5 mb-0.5">
            <span
              className="text-xs font-medium"
              style={{ color: "var(--text-secondary)" }}
            >
              Account metrics by platform
            </span>
            <InfoTooltip
              text="Account-level reach, impressions and followers as each platform reports them. This is ACCOUNT-level data and intentionally differs from the post-level Total Reach above — that one sums every post; this one is what the platform reports for the account. A blank (—) means the platform does not publish that metric at the account level (e.g. Instagram retired account impressions) — not a tracking gap. Facebook publishes no deduplicated account reach, so its reach is a page_total_media_view_unique proxy (since 2026-06-20), disclosed as a proxy and summed; Pinterest reach/impressions are a pin-sum. See the Methodology page."
              label="Why do platforms show different account metrics?"
            />
          </div>
          <div
            className="text-[10px] mb-3"
            style={{ color: "var(--text-secondary)", opacity: 0.75 }}
          >
            account-level · as each platform reports — does not match the
            post-level totals above
          </div>
          <div className="space-y-3">
            {model.accountScorecards.map((sc) => {
              const cfg = getPlatformConfig(sc.platform);
              return (
                <div
                  key={sc.platform}
                  className="rounded-lg p-3"
                  style={{
                    background: "var(--bg-secondary)",
                    border: "1px solid var(--border)",
                    borderLeftWidth: "3px",
                    borderLeftColor: cfg.color,
                  }}
                >
                  <span
                    className="text-[11px] px-1.5 py-0.5 rounded font-semibold"
                    style={{ background: cfg.colorBg, color: cfg.color }}
                  >
                    {cfg.label}
                  </span>
                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 mt-2.5">
                    <ScoreCell
                      label="Reach"
                      value={sc.reach !== null ? formatNumber(sc.reach) : "—"}
                    />
                    <ScoreCell
                      label="Impressions"
                      value={
                        sc.impressions !== null
                          ? formatNumber(sc.impressions)
                          : "—"
                      }
                    />
                    <ScoreCell
                      label="Views (30d)"
                      value={
                        sc.views != null ? formatNumber(sc.views) : "—"
                      }
                      tooltip="Instagram reports Views only as a rolling 30-day account total (Meta retired per-day account impressions). This is a 30-day figure, not a daily count, and is not summed across the selected date range. A blank (—) means the platform does not report account Views."
                    />
                    <ScoreCell
                      label="Followers"
                      value={
                        sc.followers !== null
                          ? formatNumber(sc.followers)
                          : "—"
                      }
                    />
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        {/* Needs attention */}
        <NeedsAttention
          posts={posts}
          prevPosts={prevPosts}
          dailyMetrics={dailyMetrics}
          prevDailyMetrics={prevDailyMetrics}
          alerts={alerts}
          onSelectPost={onSelectPost}
        />
      </div>

      {/* ─── 4. TRENDS OVER TIME ──────────────────────────────────────────── */}
      {/* The north-star cards show only an in-period sparkline; this block adds
          the period-over-period trend context a leader was missing (WEBDEV-182
          item 11). Chart shaping is shared with OverviewDeepDive via the pure
          trendSeries builders. */}
      <TrendCharts posts={posts} dailyMetrics={dailyMetrics} />
    </div>
  );
}

/** One reach/impressions/views/followers cell in a platform scorecard. */
function ScoreCell({
  label,
  value,
  tooltip,
}: {
  label: string;
  value: string;
  tooltip?: string;
}) {
  return (
    <div className="flex flex-col gap-0.5">
      <span
        className="text-[11px] flex items-center gap-1"
        style={{ color: "var(--text-secondary)" }}
      >
        {label}
        {tooltip ? (
          <InfoTooltip text={tooltip} label={`What is ${label}?`} />
        ) : null}
      </span>
      <span className="text-base font-bold tabular-nums">{value}</span>
    </div>
  );
}

interface NorthStarCardProps {
  label: string;
  /** Short grain/window caption shown under the label (e.g. "post-level · this window"). */
  grainNote?: string;
  value: string;
  change?: number;
  isNew?: boolean;
  series: number[];
  tooltip: string;
}

/**
 * One of the two hero metrics. The number is the hero (large, tabular), the
 * delta is bold and colour-coded (green up / red down), and a sparkline traces
 * the in-period trend. When growth is from zero, "↑ new" replaces the percent.
 */
function NorthStarCard({
  label,
  grainNote,
  value,
  change,
  isNew,
  series,
  tooltip,
}: NorthStarCardProps) {
  const isPositive = change !== undefined && change > 0;
  const isNegative = change !== undefined && change < 0;
  // Sparkline + delta share a colour: green when up (or new), red when down,
  // neutral when flat / no prior data.
  const accent = isPositive || isNew
    ? "var(--success)"
    : isNegative
      ? "var(--danger)"
      : "var(--text-secondary)";
  const arrow = isPositive ? "▲" : isNegative ? "▼" : "";

  return (
    <div
      className="rounded-xl p-5"
      style={{
        background: "var(--bg-card)",
        border: "1px solid var(--border)",
      }}
    >
      <div className="flex items-center gap-1.5 mb-0.5">
        <span
          className="text-xs font-medium"
          style={{ color: "var(--text-secondary)" }}
        >
          {label}
        </span>
        <InfoTooltip text={tooltip} label={`What is ${label}?`} />
      </div>
      {grainNote ? (
        <div
          className="text-[10px] mb-1"
          style={{ color: "var(--text-secondary)", opacity: 0.75 }}
        >
          {grainNote}
        </div>
      ) : null}

      <div className="flex items-end justify-between gap-4">
        <div className="min-w-0">
          <div className="text-4xl font-bold tabular-nums leading-none">
            {value}
          </div>
          <div className="mt-2 flex items-center gap-1.5">
            {change !== undefined ? (
              <span
                className="text-sm font-semibold"
                style={{ color: accent }}
              >
                {arrow} {Math.abs(change).toFixed(0)}%
              </span>
            ) : isNew ? (
              <span
                className="text-sm font-semibold"
                style={{ color: "var(--success)" }}
              >
                ↑ new
              </span>
            ) : (
              <span
                className="text-sm"
                style={{ color: "var(--text-secondary)" }}
              >
                no prior data
              </span>
            )}
            <span
              className="text-xs"
              style={{ color: "var(--text-secondary)" }}
            >
              vs prior period
            </span>
          </div>
        </div>

        <div style={{ color: accent }} className="shrink-0">
          <Sparkline data={series} width={120} height={40} fill />
        </div>
      </div>
    </div>
  );
}
