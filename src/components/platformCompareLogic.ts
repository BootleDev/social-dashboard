import { alignToDateArrayNullable, weightedEngagementRate, str } from "@/lib/utils";
import { isPostSettled } from "@/lib/settlement";
import type { AirtableRecord } from "@/lib/utils";

// ER trend: for FB/IG, only settled account rows contribute; unsettled dates
// become gaps (null). Pinterest is not gated here (returned as-is).
export function erSeriesForPlatform(
  platform: string, metrics: AirtableRecord[], dates: string[], field: string,
): (number | null)[] {
  const p = platform.toLowerCase();
  const rows = (p === "instagram" || p === "facebook")
    ? metrics.filter((m) => str(m.fields["data_status"]) === "settled")
    : metrics;
  return alignToDateArrayNullable(rows, dates, field);
}

// Avg ER: reach-weighted over settled posts only (isPostSettled gates FB/IG).
export function avgERSettled(posts: AirtableRecord[], today: string): number {
  return weightedEngagementRate(posts.filter((post) => isPostSettled(post, today)));
}
