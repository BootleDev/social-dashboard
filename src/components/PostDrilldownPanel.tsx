"use client";

import { useEffect } from "react";
import { str, num, formatNumber, formatLocalDate } from "@/lib/utils";
import { getPlatformConfig } from "@/lib/platforms";
import type { AirtableRecord } from "@/lib/utils";

/**
 * Reusable side-sheet that shows posts contributing to a clicked data point.
 * Decoupled from the source chart — caller provides the filtered set + a
 * metric formatter so each chart can present its own value column.
 */
interface PostDrilldownPanelProps {
  /** Posts that produced the clicked bucket. */
  posts: AirtableRecord[];
  /** What the user clicked on (e.g. "Question (49)" or "Recipe/Infusion"). */
  bucketLabel: string;
  /** Optional metric label and value formatter so the side column makes sense. */
  metricLabel?: string;
  getMetricValue?: (r: AirtableRecord) => number | undefined;
  formatMetric?: (v: number) => string;
  /** IANA timezone for date display. Empty = browser local. */
  timezone?: string;
  /** Called when the panel should close. */
  onClose: () => void;
}

export default function PostDrilldownPanel({
  posts,
  bucketLabel,
  metricLabel,
  getMetricValue,
  formatMetric,
  timezone = "",
  onClose,
}: PostDrilldownPanelProps) {
  // Close on Escape
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  const sorted = [...posts].sort((a, b) => {
    if (getMetricValue) {
      const av = getMetricValue(a) ?? -Infinity;
      const bv = getMetricValue(b) ?? -Infinity;
      if (av !== bv) return bv - av;
    }
    // Fall back to most recent first
    const ad = str(a.fields["Published At"]);
    const bd = str(b.fields["Published At"]);
    return bd.localeCompare(ad);
  });

  return (
    <div
      className="fixed inset-0 z-50 flex justify-end"
      style={{ background: "rgba(0,0,0,0.4)" }}
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-label={`Posts in bucket: ${bucketLabel}`}
    >
      <div
        className="h-full w-full max-w-[640px] overflow-y-auto p-6"
        style={{
          background: "var(--bg-primary)",
          borderLeft: "1px solid var(--border)",
        }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between mb-4">
          <div>
            <p
              className="text-xs uppercase tracking-wide"
              style={{ color: "var(--text-secondary)" }}
            >
              Posts in bucket
            </p>
            <h2 className="text-lg font-bold mt-1">{bucketLabel}</h2>
            <p
              className="text-xs mt-1"
              style={{ color: "var(--text-secondary)" }}
            >
              {posts.length} {posts.length === 1 ? "post" : "posts"}
              {metricLabel ? `, sorted by ${metricLabel}` : ""}
            </p>
          </div>
          <button
            onClick={onClose}
            aria-label="Close"
            className="text-xs rounded px-2 py-1 hover:bg-white/10"
            style={{
              border: "1px solid var(--border)",
              color: "var(--text-secondary)",
            }}
          >
            Close (Esc)
          </button>
        </div>

        {sorted.length === 0 ? (
          <p
            className="text-sm"
            style={{ color: "var(--text-secondary)" }}
          >
            No posts to show in this bucket.
          </p>
        ) : (
          <ul className="space-y-3">
            {sorted.map((p) => {
              const f = p.fields;
              const platform = str(f["Platform"]).toLowerCase();
              const platformConfig = getPlatformConfig(platform);
              // For Pinterest pins, Media URL is the destination URL (bootle.io
              // product page), not the pin permalink. Construct the pin URL
              // from the pinId (stored in Post ID as "pinterest_{pinId}").
              const postIdField = str(f["Post ID"]);
              let url = str(f["Media URL"]);
              if (platform === "pinterest" && postIdField.startsWith("pinterest_")) {
                const pinId = postIdField.slice("pinterest_".length);
                if (pinId) {
                  url = `https://www.pinterest.com/pin/${pinId}/`;
                }
              }
              const caption = str(f["Caption"]) || "(no caption)";
              const publishedAt = formatLocalDate(
                str(f["Published At"]),
                timezone || undefined,
              );
              const reach = num(f["Reach"]);
              const metricVal = getMetricValue?.(p);

              return (
                <li
                  key={p.id}
                  className="rounded-lg p-3"
                  style={{
                    background: "var(--bg-card)",
                    border: "1px solid var(--border)",
                  }}
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 mb-1">
                        <span
                          className="inline-block w-2 h-2 rounded-full"
                          style={{ background: platformConfig.color }}
                          aria-hidden
                        />
                        <span
                          className="text-xs capitalize"
                          style={{ color: "var(--text-secondary)" }}
                        >
                          {platformConfig.label} ·{" "}
                          {str(f["Post Type"]) || "post"} · {publishedAt}
                        </span>
                      </div>
                      <p className="text-sm line-clamp-3">
                        {caption.slice(0, 220)}
                        {caption.length > 220 ? "…" : ""}
                      </p>
                      <div
                        className="flex items-center gap-3 mt-2 text-xs"
                        style={{ color: "var(--text-secondary)" }}
                      >
                        <span>Reach {formatNumber(reach)}</span>
                        {metricVal !== undefined &&
                          Number.isFinite(metricVal) && (
                            <span style={{ color: "var(--text-primary)" }}>
                              {metricLabel}:{" "}
                              {formatMetric
                                ? formatMetric(metricVal)
                                : metricVal.toFixed(1)}
                            </span>
                          )}
                      </div>
                    </div>
                    {url && (
                      <a
                        href={url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-xs whitespace-nowrap rounded px-2 py-1 hover:bg-white/10"
                        style={{
                          border: "1px solid var(--border)",
                          color: "var(--accent-purple)",
                        }}
                      >
                        Open ↗
                      </a>
                    )}
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </div>
  );
}
