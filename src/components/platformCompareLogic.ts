import { alignToDateArrayNullable, weightedEngagementRate, recordReach, str } from "@/lib/utils";
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
// Returns null (not 0) when no settled post contributes positive reach — a
// false zero would contradict the honesty goal of the other null metrics
// (e.g. totalReach) rendered as an em-dash.
export function avgERSettled(posts: AirtableRecord[], today: string): number | null {
  const settled = posts.filter((post) => isPostSettled(post, today));
  const contributing = settled.filter((post) => recordReach(post) > 0);
  if (contributing.length === 0) return null;
  return weightedEngagementRate(settled);
}
