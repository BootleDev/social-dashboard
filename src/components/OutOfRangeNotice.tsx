"use client";

import { str } from "@/lib/utils";
import { getPlatformConfig } from "@/lib/platforms";
import type { AirtableRecord } from "@/lib/utils";

interface OutOfRangeNoticeProps {
  /** All posts in the dataset, before the date-range filter. */
  allPosts: AirtableRecord[];
  /** Posts after the active date-range + platform filters. */
  filteredPosts: AirtableRecord[];
  /** Currently selected platform keys (empty set = all platforms). */
  selectedPlatforms: Set<string>;
  /** Human label of the active date range, e.g. "Last 30 days". */
  rangeLabel: string;
}

/**
 * Surfaces the most common "where did my posts go" confusion: a platform that
 * HAS content in the dataset but NONE inside the active date range (e.g.
 * Pinterest, whose posts are spread across months while the default range is
 * 30 days). Tells the user to widen the date filter rather than leaving them
 * to guess why a platform looks empty.
 *
 * Renders nothing when every selected platform with data also has data in the
 * current range, or when no platform is affected.
 */
export default function OutOfRangeNotice({
  allPosts,
  filteredPosts,
  selectedPlatforms,
  rangeLabel,
}: OutOfRangeNoticeProps) {
  const platformsOf = (records: AirtableRecord[]): Set<string> => {
    const set = new Set<string>();
    for (const r of records) {
      const p = str(r.fields["Platform"]).toLowerCase().trim();
      if (p) set.add(p);
    }
    return set;
  };

  const inData = platformsOf(allPosts);
  const inRange = platformsOf(filteredPosts);

  // A platform is "hidden" if it's selected (or all are shown), has posts in
  // the dataset, but has none in the current filtered range.
  const considered = (p: string) =>
    selectedPlatforms.size === 0 || selectedPlatforms.has(p);

  const hidden = Array.from(inData)
    .filter((p) => considered(p) && !inRange.has(p))
    .sort();

  if (hidden.length === 0) return null;

  const names = hidden.map((p) => getPlatformConfig(p).label);
  const list =
    names.length === 1
      ? names[0]
      : names.length === 2
        ? `${names[0]} and ${names[1]}`
        : `${names.slice(0, -1).join(", ")}, and ${names[names.length - 1]}`;
  const verb = names.length === 1 ? "has" : "have";

  return (
    <div
      className="rounded-xl px-4 py-3 mb-4 text-sm flex items-start gap-2"
      style={{
        border: "1px solid var(--border)",
        background: "var(--bg-secondary)",
        color: "var(--text-secondary)",
      }}
      role="status"
    >
      <span aria-hidden="true">ℹ️</span>
      <span>
        {list} {verb} no posts in <strong>{rangeLabel}</strong>, but {verb}{" "}
        older posts in the data. Widen the date filter to see {verb === "has" ? "it" : "them"}.
      </span>
    </div>
  );
}
