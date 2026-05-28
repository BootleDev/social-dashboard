"use client";

import { useMemo, useState } from "react";
import { toTopPin, type TopPin } from "@/lib/types";
import { formatNumber, str } from "@/lib/utils";
import type { AirtableRecord } from "@/lib/utils";
import PostDrilldownPanel from "./PostDrilldownPanel";
import StatsPanel from "./StatsPanel";
import { describe } from "@/lib/stats";

interface PinterestTopPinsProps {
  records: AirtableRecord[];
  /** Full Posts table — used to resolve a TopPin row to its full Post record. */
  posts: AirtableRecord[];
  /** IANA timezone for date display in the drilldown panel. */
  timezone: string;
}

const SORT_BYS_AVAILABLE: Array<TopPin["sortBy"]> = [
  "IMPRESSION",
  "SAVE",
  "OUTBOUND_CLICK",
];

const SORT_LABEL: Record<TopPin["sortBy"], string> = {
  IMPRESSION: "Impressions",
  SAVE: "Saves",
  OUTBOUND_CLICK: "Outbound clicks",
  PIN_CLICK: "Pin clicks",
  ENGAGEMENT: "Engagement",
};

function latestSnapshotDate(records: TopPin[]): string {
  if (records.length === 0) return "";
  return records.reduce(
    (max, r) => (r.snapshotDate > max ? r.snapshotDate : max),
    records[0].snapshotDate,
  );
}

/**
 * Card-grid view of Bootle's top-performing pins by the selected metric.
 * Lives in Insights (looking-back analysis), not Planning. Shows image,
 * caption snippet, and key metrics so a single glance answers "what's
 * working on Pinterest right now."
 */
export default function PinterestTopPins({
  records,
  posts,
  timezone,
}: PinterestTopPinsProps) {
  const [sortBy, setSortBy] = useState<TopPin["sortBy"]>("OUTBOUND_CLICK");
  const [drilldown, setDrilldown] = useState<{
    posts: AirtableRecord[];
    label: string;
  } | null>(null);

  // Map Post ID -> full Post record so we can show thumbnail + caption from
  // Posts (the source of truth for media). Top Pins table itself doesn't
  // store these — Posts does.
  const postsByPostId = useMemo(() => {
    const m = new Map<string, AirtableRecord>();
    for (const p of posts) {
      const pid = str(p.fields["Post ID"]);
      if (pid) m.set(pid, p);
    }
    return m;
  }, [posts]);

  const pins = useMemo(() => records.map(toTopPin), [records]);
  const latestDate = useMemo(() => latestSnapshotDate(pins), [pins]);

  const filtered = useMemo(
    () =>
      pins
        .filter((p) => p.snapshotDate === latestDate && p.sortBy === sortBy)
        .sort((a, b) => a.rank - b.rank)
        .slice(0, 12),
    [pins, latestDate, sortBy],
  );

  if (records.length === 0) {
    return (
      <div
        className="rounded-xl p-5 text-xs"
        style={{
          background: "var(--bg-card)",
          border: "1px solid var(--border)",
          color: "var(--text-secondary)",
        }}
      >
        No Top Pins data yet. The Pinterest Trends Refresher populates this
        daily.
      </div>
    );
  }

  return (
    <div
      className="rounded-xl p-5"
      style={{
        background: "var(--bg-card)",
        border: "1px solid var(--border)",
      }}
    >
      <div className="flex items-center justify-between mb-4 flex-wrap gap-2">
        <div>
          <h3
            className="text-sm font-medium"
            style={{ color: "var(--text-primary)" }}
          >
            Top performing pins
          </h3>
          {latestDate && (
            <span
              className="text-xs"
              style={{ color: "var(--text-secondary)" }}
            >
              Last 30 days · ranked by {SORT_LABEL[sortBy].toLowerCase()} · snapshot {latestDate}
            </span>
          )}
        </div>
        <div className="flex gap-1 items-center">
          {SORT_BYS_AVAILABLE.map((s) => (
            <button
              key={s}
              onClick={() => setSortBy(s)}
              className="text-xs px-2 py-1 rounded cursor-pointer transition-colors"
              style={{
                background:
                  sortBy === s ? "var(--brand)" : "var(--bg-secondary)",
                color: sortBy === s ? "#fff" : "var(--text-secondary)",
                border: "1px solid var(--border)",
              }}
            >
              {SORT_LABEL[s]}
            </button>
          ))}
          <StatsPanel
            stats={(() => {
              const values = filtered.map((p) =>
                sortBy === "IMPRESSION"
                  ? p.impressions
                  : sortBy === "SAVE"
                    ? p.saves
                    : p.outboundClick,
              );
              return describe(values);
            })()}
            format={(v) => formatNumber(v)}
            context={`${SORT_LABEL[sortBy]} distribution across top pins`}
          />
        </div>
      </div>

      {filtered.length === 0 ? (
        <p className="text-xs" style={{ color: "var(--text-secondary)" }}>
          No top-pins data for this metric yet.
        </p>
      ) : (
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-3">
          {filtered.map((p) => {
            const matchedPost = postsByPostId.get(p.postId);
            // Prefer the thumbnail written directly into Top Pins. Falls back
            // to the joined Post record (works for pins still in the 180d
            // refresher window). Old top pins surfacing in lifetime rankings
            // have neither — they show "no thumbnail" until the workflow
            // backfills.
            const thumbnail =
              p.thumbnailUrl ||
              (matchedPost ? str(matchedPost.fields["Thumbnail URL"]) : "");
            const caption = matchedPost
              ? str(matchedPost.fields["Caption"])
              : "";
            const captionSnippet =
              caption.length > 90 ? caption.slice(0, 90).trim() + "…" : caption;
            const headlineMetric =
              sortBy === "IMPRESSION"
                ? formatNumber(p.impressions)
                : sortBy === "SAVE"
                  ? formatNumber(p.saves)
                  : formatNumber(p.outboundClick);

            return (
              <button
                key={p.id}
                onClick={() => {
                  if (matchedPost) {
                    setDrilldown({
                      posts: [matchedPost],
                      label: `Pin #${p.rank} by ${SORT_LABEL[p.sortBy]}`,
                    });
                  } else {
                    window.open(
                      `https://www.pinterest.com/pin/${p.pinId}/`,
                      "_blank",
                      "noopener,noreferrer",
                    );
                  }
                }}
                className="text-left rounded-lg overflow-hidden hover:brightness-110 transition-all cursor-pointer flex flex-col"
                style={{
                  background: "var(--bg-secondary)",
                  border: "1px solid var(--border)",
                }}
                title={
                  matchedPost
                    ? "Click for full post detail"
                    : "Open on Pinterest (no matching Post record locally)"
                }
              >
                <div
                  className="relative w-full"
                  style={{ aspectRatio: "2 / 3", background: "var(--bg-secondary)" }}
                >
                  {thumbnail ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={thumbnail}
                      alt={captionSnippet || `Pin #${p.rank}`}
                      className="w-full h-full object-cover"
                      loading="lazy"
                    />
                  ) : (
                    <div
                      className="w-full h-full flex items-center justify-center text-[10px]"
                      style={{ color: "var(--text-secondary)" }}
                    >
                      no thumbnail
                    </div>
                  )}
                  <span
                    className="absolute top-1.5 left-1.5 text-[10px] px-1.5 py-0.5 rounded font-medium"
                    style={{
                      background: "var(--brand)",
                      color: "#fff",
                    }}
                  >
                    #{p.rank}
                  </span>
                </div>
                <div className="p-2.5 flex-1 flex flex-col justify-between gap-1.5">
                  <p
                    className="text-[11px] line-clamp-3"
                    style={{ color: "var(--text-primary)" }}
                  >
                    {captionSnippet || (
                      <span style={{ color: "var(--text-secondary)" }}>
                        (no caption)
                      </span>
                    )}
                  </p>
                  <div
                    className="text-xs flex items-baseline justify-between"
                    style={{ color: "var(--text-secondary)" }}
                  >
                    <span style={{ color: "var(--text-primary)" }}>
                      {headlineMetric}
                    </span>
                    <span className="text-[10px] opacity-70">
                      {SORT_LABEL[sortBy]}
                    </span>
                  </div>
                </div>
              </button>
            );
          })}
        </div>
      )}

      {drilldown && (
        <PostDrilldownPanel
          posts={drilldown.posts}
          bucketLabel={drilldown.label}
          timezone={timezone}
          onClose={() => setDrilldown(null)}
        />
      )}
    </div>
  );
}
