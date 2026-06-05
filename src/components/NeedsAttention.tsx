"use client";

import { useMemo } from "react";
import {
  num,
  str,
  formatNumber,
  recordReach,
  topPosts,
  windowReachChange,
  sumReach,
  hasRealReach,
  groupByPlatform,
  getPlatformKeys,
} from "@/lib/utils";
import { getPlatformConfig } from "@/lib/platforms";
import type { AirtableRecord } from "@/lib/utils";

/**
 * The "Needs attention" triage panel — the one thing a leader scans. It blends
 * two sources so it is never empty when there is signal:
 *
 *   1. Auto-fired alerts (ER drops, reach declines, viral posts) from the
 *      SOCIAL_ALERTS log, deduped to one row per distinct condition (the log
 *      re-emits the same condition daily; see AlertsFeed for the rationale).
 *   2. Derived findings computed here from the current window — a "biggest
 *      mover" (largest per-platform account-reach swing vs the prior period)
 *      and a "top post" (highest ER post with a real impression floor). These
 *      guarantee the panel says *something* useful even on a quiet day.
 *
 * Findings are one line each with a severity dot. Capped at 4 — this is a scan,
 * not a feed. The full alert history lives in the deep-dive / Ops surfaces.
 */

type Severity = "critical" | "warning" | "info" | "good";

interface Finding {
  /** Stable key for React. */
  id: string;
  severity: Severity;
  text: string;
  /** Optional post to open in the drilldown when the row is clicked. */
  post?: AirtableRecord;
}

interface NeedsAttentionProps {
  /** Date+platform-filtered posts for the current window. */
  posts: AirtableRecord[];
  /** Prior-period posts (same duration, immediately before). */
  prevPosts: AirtableRecord[];
  /** Account-grain daily facts for the window (Account Daily Facts). */
  dailyMetrics: AirtableRecord[];
  /** Prior-period account-grain daily facts. */
  prevDailyMetrics: AirtableRecord[];
  /** Raw alerts (date+platform filtered), newest-first. */
  alerts: AirtableRecord[];
  /** Open the post drilldown for a finding that names a post. */
  onSelectPost: (post: AirtableRecord) => void;
}

const DOT_COLOR: Record<Severity, string> = {
  critical: "var(--danger)",
  warning: "var(--warning)",
  info: "var(--info)",
  good: "var(--success)",
};

// Map a raw alert Severity string to our 4-level dot scale.
function alertSeverity(raw: string): Severity {
  const s = raw.toUpperCase();
  if (s === "CRITICAL") return "critical";
  if (s === "HIGH") return "warning";
  if (s === "MEDIUM") return "info";
  return "info";
}

/**
 * Largest account-reach swing across platforms vs the prior period. Only
 * platforms that report real account reach are eligible (FB has none; Pinterest
 * is a pin-sum, IG is real) — so this never invents a mover from a structural
 * blank. Returns the single biggest absolute %-move, up or down. Moves off a
 * near-zero prior base (small-denominator artifacts) are excluded via
 * significantPctChange, so a tiny prior window can't surface as a huge percent.
 */
function biggestMover(
  dailyMetrics: AirtableRecord[],
  prevDailyMetrics: AirtableRecord[],
): { platform: string; change: number } | null {
  const cur = groupByPlatform(dailyMetrics);
  const prev = groupByPlatform(prevDailyMetrics);
  const keys = getPlatformKeys(dailyMetrics);

  let best: { platform: string; change: number } | null = null;
  for (const key of keys) {
    const curRows = (cur.get(key) ?? []).filter(hasRealReach);
    const prevRows = (prev.get(key) ?? []).filter(hasRealReach);
    if (curRows.length === 0 || prevRows.length === 0) continue;

    const curReach = sumReach(curRows);
    const prevReach = sumReach(prevRows);
    // Compare per-day AVERAGE reach with coverage guards, not raw window sums.
    // curRows/prevRows are per-day fact rows, so their lengths are the measured
    // day-counts. This is what stops a sparse prior window (e.g. 2 measured
    // days vs 26) from inventing an explosive percentage like "up 3545%".
    const change = windowReachChange(
      curReach,
      curRows.length,
      prevReach,
      prevRows.length,
    );
    if (change === undefined) continue;

    if (best === null || Math.abs(change) > Math.abs(best.change)) {
      best = { platform: key, change };
    }
  }
  return best;
}

export default function NeedsAttention({
  posts,
  prevPosts: _prevPosts,
  dailyMetrics,
  prevDailyMetrics,
  alerts,
  onSelectPost,
}: NeedsAttentionProps) {
  const findings = useMemo<Finding[]>(() => {
    const out: Finding[] = [];

    // 1. Biggest account-reach mover vs prior period.
    const mover = biggestMover(dailyMetrics, prevDailyMetrics);
    if (mover && Math.abs(mover.change) >= 5) {
      const cfg = getPlatformConfig(mover.platform);
      const dir = mover.change >= 0 ? "up" : "down";
      // A reach decline is the thing that needs attention; a rise is good news.
      const severity: Severity = mover.change >= 0 ? "good" : "warning";
      out.push({
        id: `mover-${mover.platform}`,
        severity,
        text: `${cfg.label} reach ${dir} ${Math.abs(mover.change).toFixed(
          0,
        )}% vs prior period`,
      });
    }

    // 2. Deduped alerts — one row per distinct condition, newest kept.
    //    Same identity rule as AlertsFeed (Type|Platform|PostID-or-Message).
    const seen = new Set<string>();
    for (const alert of alerts) {
      const postId = str(alert.fields["Post ID"]);
      const type = str(alert.fields["Type"]);
      const platform = str(alert.fields["Platform"]);
      const message = str(alert.fields["Message"]);
      const identity = [type, platform, postId || message].join("|");
      if (seen.has(identity)) continue;
      seen.add(identity);

      // Resolve a post-scoped alert to a visible post; skip if out of range.
      let post: AirtableRecord | undefined;
      if (postId) {
        post = posts.find((p) => str(p.fields["Post ID"]) === postId);
        if (!post) continue;
      }

      const cfg = getPlatformConfig(platform);
      const label = message || type.replace(/_/g, " ").toLowerCase();
      out.push({
        id: alert.id || identity,
        severity: alertSeverity(str(alert.fields["Severity"])),
        text: `${cfg.label}: ${label}`,
        post,
      });
      if (out.length >= 3) break; // leave room for the top-post line
    }

    // 3. Top post by ER (50-impression floor so a 1-impression pin can't win).
    const [top] = topPosts(posts, "Engagement Rate", 1, { minImpressions: 50 });
    if (top) {
      const cfg = getPlatformConfig(str(top.fields["Platform"]));
      const er = num(top.fields["Engagement Rate"]) * 100;
      const type = str(top.fields["Post Type"]) || "post";
      const reach = recordReach(top);
      out.push({
        id: `top-${top.id}`,
        severity: "good",
        text: `Top post: ${cfg.label} ${type}, ${er.toFixed(
          1,
        )}% ER · ${formatNumber(reach)} reach`,
        post: top,
      });
    }

    return out.slice(0, 4);
  }, [posts, dailyMetrics, prevDailyMetrics, alerts]);

  return (
    <div
      className="rounded-xl p-4 h-full flex flex-col"
      style={{ background: "var(--bg-card)", border: "1px solid var(--border)" }}
    >
      <span
        className="text-xs font-medium mb-3"
        style={{ color: "var(--text-secondary)" }}
      >
        Needs attention
      </span>

      {findings.length === 0 ? (
        <p
          className="text-sm flex-1 flex items-center"
          style={{ color: "var(--text-secondary)" }}
        >
          Nothing flagged this period. Metrics are tracking as expected.
        </p>
      ) : (
        <ul className="space-y-2">
          {findings.map((f) => {
            const row = (
              <span className="flex items-start gap-2.5">
                <span
                  className="mt-1.5 w-2 h-2 rounded-full shrink-0"
                  style={{ background: DOT_COLOR[f.severity] }}
                  aria-hidden="true"
                />
                <span
                  className="text-sm leading-snug"
                  style={{ color: "var(--text-primary)" }}
                >
                  {f.text}
                </span>
              </span>
            );

            if (f.post) {
              const post = f.post;
              return (
                <li key={f.id}>
                  <button
                    type="button"
                    onClick={() => onSelectPost(post)}
                    className="w-full text-left rounded-lg px-2 py-1.5 -mx-2 transition-colors cursor-pointer hover:bg-black/[0.03] dark:hover:bg-white/[0.04]"
                  >
                    {row}
                  </button>
                </li>
              );
            }
            return (
              <li key={f.id} className="px-2 py-1.5 -mx-2">
                {row}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
