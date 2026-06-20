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

// ---------------------------------------------------------------------------
// social.account_daily_facts -> getAccountDailyFacts (WEBDEV-228)
// ---------------------------------------------------------------------------
//
// The SOLE source for account-grain KPIs (WEBDEV-146): one row per platform|date
// with per-metric Source provenance. This map is the EXACT 1:1 of the Airtable
// "Account Daily Facts" table's 21 fields (verified live 2026-06-20 against
// tblgKAMI1pF3FjQGo) so the Supabase envelope is byte-for-byte identical to the
// Airtable getter's. Consumers read these display-name keys directly:
//   - hasRealReach / hasRealImpressions (utils.ts) — "Reach Source" /
//     "Impressions Source" gate whether a row's volume is summed into the
//     account headline. Values: daily_real / pin_sum are real-and-summable;
//     daily_proxy / the literal STRING "null" / period_aggregate are not.
//   - OverviewDeepDive — "Period Source" === "period_aggregate" routes the IG
//     rolling-30d tiles (NOT the reach sums); the *_30d display keys feed them.
//   - MethodologyContent — "data_status" (snake_case, NOT title-case), plus the
//     distinct "Reach Source" / "Impressions Source" value sets.
//   - PlatformCompare / Overview — Followers, Reach, Impressions, Profile Views,
//     Engagement Rate.
//
// KEYS THAT DIFFER FROM THE PLAN'S DRAFT FIELD MAP (corrected against live data):
//   * follower_delta -> "Follower Delta" (NOT "Followers Gained"). The plan
//     conflated this with the LEGACY Daily Account Metrics table, whose field IS
//     "Followers Gained" (DAILY_MAP above). The ADF table's field is literally
//     "Follower Delta"; mapping to the wrong name would break envelope parity.
//   * snapshot_key -> "Snapshot Key" and restatement_log -> "Restatement Log"
//     are INCLUDED (the plan listed them as omit). Airtable emits "Snapshot Key"
//     on EVERY row (= platform|date), so omitting it would create a guaranteed
//     per-row key-set divergence from the Airtable getter; including it keeps the
//     envelope identical. No consumer reads either (both are harmless
//     passthroughs); "Restatement Log" is sparse today (all rows null -> omitted
//     by buildFields, matching Airtable's empty-cell omission) but stays in parity
//     if a restatement is ever logged.
//
// ENGAGEMENT-RATE UNIT (the #1 review risk, same as DAILY_MAP): engagement_rate
// is a FRACTION (live range 0.00–0.25); the dashboard does num(x) * 100 on the
// same axis as the Airtable posts-derived ER line, so it MUST stay a fraction.
// pg returns numeric as a STRING (no OID-1700 typeparser in supabase.ts), so the
// value arrives like "0.0860"; buildFields passes it through verbatim and num()
// in the components parses it. Note Airtable stores the full-precision float
// (0.08602150537634409) while Postgres rounds to the numeric column's scale
// (0.0860) — the rendered ER (~8.6%) is identical, so the offline parity test
// compares Engagement Rate with toBeCloseTo, not strict equality.
export const ACCOUNT_DAILY_FACTS_MAP: Array<[string, string]> = [
  ["snapshot_key", "Snapshot Key"],
  ["platform", "Platform"],
  ["date", "Date"],
  ["reach", "Reach"],
  ["reach_source", "Reach Source"],
  ["impressions", "Impressions"],
  ["impressions_source", "Impressions Source"],
  ["views", "Views"],
  ["views_source", "Views Source"],
  ["profile_views", "Profile Views"],
  ["followers", "Followers"],
  ["follower_delta", "Follower Delta"],
  ["engagement", "Engagement"],
  ["engagement_rate", "Engagement Rate"],
  ["data_status", "data_status"],
  ["restatement_log", "Restatement Log"],
  ["profile_views_30d", "Profile Views (30d)"],
  ["accounts_engaged_30d", "Accounts Engaged (30d)"],
  ["interactions_30d", "Interactions (30d)"],
  ["profile_links_taps_30d", "Profile Links Taps (30d)"],
  ["period_source", "Period Source"],
];

/**
 * Map an account_daily_facts row to the Airtable envelope.
 * id = `${platform}|${date}` (one row per platform per day, matching the
 * snapshot_key upsert key). The Airtable getter returns the Airtable record id
 * here instead, but no consumer of account facts relies on the id being an
 * Airtable rec id (only the Posts inline-tag editor uses rec ids), so the
 * synthetic composite id is the same intentional substitution mapDailyRow makes.
 */
export function mapAccountDailyFactsRow(
  row: Record<string, unknown>,
): AirtableRecord {
  return {
    id: `${row.platform}|${row.date}`,
    fields: buildFields(row, ACCOUNT_DAILY_FACTS_MAP),
    createdTime: toCreatedTime(row.updated_at),
  };
}
