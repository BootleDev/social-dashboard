import { str } from "@/lib/utils";
import type { AirtableRecord } from "@/lib/utils";

// MIRROR of the n8n writer settle window (social-data-refresher: Build Post
// Facts + Fetch Social Data). Kept in sync by hand — separate runtimes cannot
// share code. See spec 2026-07-02-fbig-post-facts-and-settlement-design.md §2.
export const FB_SETTLE_DAYS = 3;
export const IG_SETTLE_DAYS = 21;

/**
 * Is a FB/IG post old enough that its lifetime metrics have mostly settled?
 * Only gates instagram/facebook; every other platform returns true (not gated).
 * A post with no parseable publish date returns true (never hide data on a
 * missing field).
 */
export function isPostSettled(post: AirtableRecord, today: string): boolean {
  const platform = str(post.fields["Platform"]).toLowerCase();
  if (platform !== "instagram" && platform !== "facebook") return true;
  const published = str(post.fields["Published At"]) || str(post.fields["Snapshot Date"]);
  const day = published.split("T")[0];
  if (!day) return true;
  const ageDays = Math.floor(
    (new Date(today + "T00:00:00Z").getTime() - new Date(day + "T00:00:00Z").getTime()) / 86400000,
  );
  const window = platform === "instagram" ? IG_SETTLE_DAYS : FB_SETTLE_DAYS;
  return ageDays > window;
}
