"use client";

import { useMemo } from "react";
import { str } from "@/lib/utils";
import type { AirtableRecord } from "@/lib/utils";

interface AlertsFeedProps {
  alerts: AirtableRecord[];
  /**
   * The currently-visible (date- and platform-filtered) posts. Used to resolve
   * an alert's `Post ID` to a real post record. An alert whose post is not in
   * this set is treated as out of range and hidden.
   */
  posts: AirtableRecord[];
  /** Open the post drilldown for a clicked alert's underlying post. */
  onSelectPost: (post: AirtableRecord) => void;
}

// Severity -> semantic theme tokens. CRITICAL = danger, HIGH = warning,
// MEDIUM = info (brand blue), LOW = neutral surface. These invert with the
// light/dark theme via the CSS-variable-backed Tailwind tokens.
const severityColors: Record<string, string> = {
  CRITICAL: "bg-danger-soft text-danger border-danger",
  HIGH: "bg-warning-soft text-warning border-warning",
  MEDIUM: "bg-info-soft text-info border-info",
  LOW: "bg-surface-secondary text-muted border-hairline",
};

const typeIcons: Record<string, string> = {
  ER_DROP: "\u{1F4C9}",
  REACH_DECLINE: "\u{1F4C9}",
  VIRAL_POST: "\u{1F525}",
  FOLLOWER_SPIKE: "\u{1F4C8}",
  FOLLOWER_DROP: "\u{1F4C9}",
};

/** An alert paired with the post it references (if any, and if in range). */
interface ResolvedAlert {
  alert: AirtableRecord;
  /** The matched post, or null for non-post-scoped alerts (e.g. follower spikes). */
  post: AirtableRecord | null;
}

export default function AlertsFeed({
  alerts,
  posts,
  onSelectPost,
}: AlertsFeedProps) {
  // Index visible posts by their platform "Post ID" so alerts can resolve to a
  // real post in O(1). Only posts in this map are considered "in range".
  const postsByPostId = useMemo(() => {
    const m = new Map<string, AirtableRecord>();
    for (const p of posts) {
      const pid = str(p.fields["Post ID"]);
      if (pid) m.set(pid, p);
    }
    return m;
  }, [posts]);

  // Resolve, deduplicate, and filter.
  //
  // The SOCIAL_ALERTS table is a daily-snapshot log: the same underlying
  // condition (a viral post, an ER drop, a heartbeat) re-emits a fresh record
  // every day it persists. Counting raw records inflates the total with daily
  // repeats — over a 30-day window one viral post becomes ~30 "alerts" — so the
  // header count never matches the timeframe. We collapse each distinct alert to
  // its most recent occurrence before counting or rendering.
  //
  // Identity is date-independent: Type + Platform + the thing it's about
  // (Post ID for post-scoped alerts, else the Message). `alerts` arrives sorted
  // newest-first, so first-seen wins and we keep the latest occurrence.
  //
  // Filtering: an alert that names a Post ID but whose post is not in range is
  // dropped entirely (the signal is meaningless if its post is outside the
  // user's current window). Alerts with no Post ID are account-level (follower
  // spikes/drops, heartbeats) and always pass through, unlinked.
  const visible = useMemo<ResolvedAlert[]>(() => {
    const seen = new Set<string>();
    return alerts.flatMap((alert): ResolvedAlert[] => {
      const postId = str(alert.fields["Post ID"]);
      const identity = [
        str(alert.fields["Type"]),
        str(alert.fields["Platform"]),
        postId || str(alert.fields["Message"]),
      ].join("|");
      if (seen.has(identity)) return [];
      seen.add(identity);

      if (!postId) return [{ alert, post: null }];
      const post = postsByPostId.get(postId);
      if (!post) return [];
      return [{ alert, post }];
    });
  }, [alerts, postsByPostId]);

  if (visible.length === 0) {
    return (
      <div
        className="rounded-xl p-5"
        style={{ background: "var(--bg-card)", border: "1px solid var(--border)" }}
      >
        <h3 className="text-sm font-medium mb-4" style={{ color: "var(--text-secondary)" }}>
          Alerts
        </h3>
        <p className="text-sm" style={{ color: "var(--text-secondary)" }}>
          No active alerts
        </p>
      </div>
    );
  }

  return (
    <div
      className="rounded-xl p-5"
      style={{ background: "var(--bg-card)", border: "1px solid var(--border)" }}
    >
      <h3 className="text-sm font-medium mb-4" style={{ color: "var(--text-secondary)" }}>
        {/* Plain count of distinct alerts in the selected period. The list shows
            all of them (scrollable) for a rolling, fresh view, no cap. */}
        Alerts ({visible.length})
      </h3>
      <div className="space-y-2 max-h-[340px] overflow-y-auto">
        {visible.map(({ alert, post }, i) => {
          const type = str(alert.fields["Type"]);
          const severity = str(alert.fields["Severity"]);
          const platform = str(alert.fields["Platform"]);
          const message = str(alert.fields["Message"]);
          const date = str(alert.fields["Alert Date"]);
          const colorClass = severityColors[severity] || severityColors.LOW;
          const icon = typeIcons[type] || "⚠️";

          const body = (
            <>
              <div className="flex items-center justify-between mb-1">
                <span className="font-medium">
                  {icon} {type}
                </span>
                <span className="opacity-70">{date?.split("T")[0]}</span>
              </div>
              <div className="opacity-90 capitalize">{platform}</div>
              <div className="opacity-70 mt-0.5">{message}</div>
            </>
          );

          const baseClass = `rounded-lg px-3 py-2 border text-xs ${colorClass}`;

          // Post-linked alerts render as a button that opens the drilldown.
          // Account-level alerts (no post) render as a plain, non-interactive card.
          if (post) {
            return (
              <button
                key={alert.id || i}
                type="button"
                onClick={() => onSelectPost(post)}
                className={`${baseClass} w-full text-left cursor-pointer transition-colors hover:brightness-110`}
              >
                {body}
              </button>
            );
          }

          return (
            <div key={alert.id || i} className={baseClass}>
              {body}
            </div>
          );
        })}
      </div>
    </div>
  );
}
