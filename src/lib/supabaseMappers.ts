/**
 * Pure row -> envelope mappers for the three Supabase-migrated tables.
 *
 * Extracted from supabase.ts (WEBDEV-207) so the shape-critical mapping logic is
 * unit-testable WITHOUT a live DB and without importing the `server-only` /
 * `pg` connection layer. supabase.ts runs the queries and hands each raw pg row
 * to the matching mapper here; these functions contain no I/O and no side
 * effects, so they can be exercised directly in vitest.
 *
 * Every mapper returns the SAME envelope the Airtable getters return:
 *   { id, fields: { <Airtable display-name keys> }, createdTime }
 * A field key is emitted ONLY when its DB value is non-null, reproducing
 * Airtable's sparse-record shape (Airtable omits empty cells from `fields`),
 * which the dashboard relies on to render "—" instead of 0 for never-populated
 * columns (e.g. Website Clicks, Impressions). A SQL 0 is a real value and IS
 * emitted; only null/undefined is dropped.
 */

import type { AirtableRecord } from "./utils";

/**
 * Build a fields object from a row, emitting a key only when the column value
 * is non-null/undefined. Reproduces Airtable's sparse-record shape.
 */
export function buildFields(
  row: Record<string, unknown>,
  map: Array<[column: string, displayName: string]>,
): Record<string, unknown> {
  const fields: Record<string, unknown> = {};
  for (const [column, displayName] of map) {
    const v = row[column];
    if (v !== null && v !== undefined) {
      fields[displayName] = v;
    }
  }
  return fields;
}

/** ISO createdTime for the envelope, from a timestamptz `updated_at`. */
export function toCreatedTime(updatedAt: unknown): string {
  if (updatedAt instanceof Date) return updatedAt.toISOString();
  if (typeof updatedAt === "string") {
    const d = new Date(updatedAt);
    if (!isNaN(d.getTime())) return d.toISOString();
  }
  return new Date(0).toISOString();
}

// ---------------------------------------------------------------------------
// social.daily_account_metrics -> getDailyAccountMetrics
// ---------------------------------------------------------------------------
//
// Column -> Airtable "Daily Account Metrics" display-name map. The display
// names are the EXACT keys the dashboard reads (Overview / PlatformCompare /
// AudienceGrowth / chat route / utils via fields['Date'] + fields['Platform']).
//
// ENGAGEMENT-RATE UNIT (the #1 review risk): engagement_rate is stored as a
// FRACTION (e.g. 0.0870 = 8.70%), identical to how Airtable's daily metrics
// stored it. The Overview / PlatformCompare ER trend charts do
// num(fields['Engagement Rate']) * 100 and plot that on the SAME axis as the
// Airtable POSTS-derived ER line (which is also a fraction * 100). So we MUST
// pass the fraction through unchanged — converting to a percent here would
// render the migrated daily ER 100x too large against the unchanged posts line.
// pg returns numeric as a string; num() in the components parses that string
// identically to a JS number, so the value is passed through verbatim here and
// the fraction-vs-percent invariant is locked by supabaseMappers.test.ts.
export const DAILY_MAP: Array<[string, string]> = [
  ["date", "Date"],
  ["platform", "Platform"],
  ["followers", "Followers"],
  ["followers_gained", "Followers Gained"],
  ["impressions", "Impressions"],
  ["reach", "Reach"],
  ["profile_views", "Profile Views"],
  ["website_clicks", "Website Clicks"],
  ["engagement_rate", "Engagement Rate"],
  ["er_type", "ER Type"],
];

/**
 * Map a daily_account_metrics row to the Airtable envelope.
 * id = `${platform}|${date}` (one row per platform per day).
 */
export function mapDailyRow(row: Record<string, unknown>): AirtableRecord {
  return {
    id: `${row.platform}|${row.date}`,
    fields: buildFields(row, DAILY_MAP),
    createdTime: toCreatedTime(row.updated_at),
  };
}

// ---------------------------------------------------------------------------
// social.weekly_summaries -> getWeeklySummaries
// ---------------------------------------------------------------------------
export const WEEKLY_MAP: Array<[string, string]> = [
  ["week_start", "Week Start"],
  ["period", "Period"],
  ["posts_analysed", "Posts Analysed"],
  ["full_report", "Full Report"],
  ["top_post", "Top Post"],
  ["platform_breakdown", "Platform Breakdown"],
];

/**
 * Map a weekly_summaries row to the Airtable envelope.
 * No natural id column; synthesize from week_start (the component takes
 * summaries[0], so the caller's desc sort is what's load-bearing, not the id).
 */
export function mapWeeklyRow(row: Record<string, unknown>): AirtableRecord {
  return {
    id: `week|${row.week_start}`,
    fields: buildFields(row, WEEKLY_MAP),
    createdTime: toCreatedTime(row.updated_at),
  };
}

// ---------------------------------------------------------------------------
// social.social_alerts -> getSocialAlerts
// ---------------------------------------------------------------------------
export const ALERTS_MAP: Array<[string, string]> = [
  ["alert_date", "Alert Date"],
  ["platform", "Platform"],
  ["type", "Type"],
  ["severity", "Severity"],
  ["message", "Message"],
  ["post_id", "Post ID"],
];

/**
 * Map a social_alerts row to the Airtable envelope.
 * Real bigint id -> string (envelope ids are strings; AlertsFeed uses it as the
 * React key). pg parses int8 to a JS number upstream; String() is safe either
 * way.
 */
export function mapAlertRow(row: Record<string, unknown>): AirtableRecord {
  return {
    id: String(row.id),
    fields: buildFields(row, ALERTS_MAP),
    createdTime: toCreatedTime(row.updated_at),
  };
}
