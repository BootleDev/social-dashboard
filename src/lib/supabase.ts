/**
 * Supabase (Postgres) read layer for the social dashboard's migrated tables.
 *
 * WEBDEV-207 (dashboard, second cutover): the lowest-risk slice of the Airtable
 * -> Supabase machine-data migration. ONLY the three fully-migrated, machine-
 * written tables are repointed here:
 *   - social.daily_account_metrics   (-> getDailyAccountMetrics)
 *   - social.weekly_summaries        (-> getWeeklySummaries)
 *   - social.social_alerts           (-> getSocialAlerts)
 * Every other getter (getPosts, getContentLibrary) stays on Airtable: POSTS and
 * CONTENT_LIBRARY are human-edited and are NOT migrated. See ./airtable.ts.
 *
 * Mechanism: a direct node-pg connection over SUPABASE_DB_URL, SERVER-SIDE ONLY
 * (the `import "server-only"` below turns any client import into a build error).
 * SUPABASE_DB_URL must be the Supabase TRANSACTION POOLER
 * (...pooler.supabase.com:6543) — short-lived serverless invocations should
 * never hold a direct-Postgres connection. The connection string is read from
 * process.env at runtime and must never be exposed to the client (no PUBLIC_/
 * NEXT_PUBLIC_ prefix). The connection gotchas below mirror the hardened
 * social-studio layer and ~/Projects/Bootle/shared/cc-bridge/db.js:
 *   - the Supabase DB-URL password can contain % or ?, which makes WHATWG
 *     `new URL()` (and pg-connection-string) throw "Invalid URL", so we parse
 *     the URL into discrete fields and hand the password to the driver verbatim
 *   - TLS is verified against the pinned Supabase Root 2021 CA (the pooler
 *     presents a private chain whose self-signed root is not in the system
 *     trust store), so rejectUnauthorized stays true (full cert + hostname
 *     verification) instead of an accept-anything posture
 *   - a `pool.on('error')` listener so an idle backend drop (pooler idle
 *     timeout, DB restart, network blip) is logged and swallowed instead of
 *     escalating to an uncaught exception that crashes the process
 *   - the connect/query timeouts below time-bound a slow/hung pooler, and every
 *     read is additionally wrapped in a Promise.race(4000ms) so a stall ALWAYS
 *     fails over to Airtable fast (the Supavisor pooler may not honour
 *     statement_timeout)
 *   - setTypeParser(1082, identity) so a `date` column comes back as its raw
 *     "YYYY-MM-DD" string (matching the Airtable date strings exactly) rather
 *     than a JS Date, which would shift under the server's timezone.
 *
 * Every reader returns the SAME envelope the Airtable getters return: an
 * AirtableRecord ({ id, fields: { <Airtable display-name keys> }, createdTime })
 * so the components and /api routes are untouched. A field key is only emitted
 * when its DB value is non-null, reproducing Airtable's sparse-record shape
 * (Airtable omits empty cells); this keeps the dashboard's "— when never
 * populated" logic (Website Clicks, Impressions) behaving identically.
 */

import "server-only";
import pg from "pg";
import type { AirtableRecord } from "./utils";
import { SUPABASE_ROOT_CA_2021 } from "./supabase-ca";

// int8 (OID 20): return as a JS number, not a string. social.social_alerts.id
// is bigint; we render it to a string when building the envelope, but parsing
// it as a number first avoids any lexicographic surprises elsewhere.
pg.types.setTypeParser(20, (v) => (v === null ? null : Number(v)));
// date (OID 1082): return the raw "YYYY-MM-DD" string verbatim. The default
// parser builds a local-midnight JS Date that would then stringify with a
// timezone offset; we need the exact Airtable string. This parser IS load-
// bearing for date / week_start / alert_date — do not remove it.
pg.types.setTypeParser(1082, (v) => v);

const DB_URL = process.env.SUPABASE_DB_URL;

// Hard ceiling on the whole Supabase read (connect + TLS + query). Belt-and-
// suspenders over the pg-level timeouts below: the Supavisor pooler may not
// honour statement_timeout, so a Promise.race guarantees each getter fails over
// to Airtable rather than hanging the dashboard / chat route.
const SUPABASE_READ_TIMEOUT_MS = 4000;

let pool: pg.Pool | null = null;

/**
 * Parse postgres://user:password@host[:port]/db into discrete fields. We do NOT
 * hand the raw URL to pg's connectionString option: Supabase DB passwords can
 * contain characters (e.g. % or ?) that are not percent-encoded, which makes
 * WHATWG `new URL()` throw. The password group is greedy up to the LAST '@' so
 * an '@' inside it is tolerated; the host segment after it never contains '@'.
 *
 * Module-private on purpose: it returns the cleartext password, so we keep the
 * surface narrow (not exported).
 */
function parseDbUrl(url: string): {
  user: string;
  password: string;
  host: string;
  port: number;
  database: string;
} {
  const m = url.match(
    /^postgres(?:ql)?:\/\/([^:]+):(.*)@([^:@/]+)(?::(\d+))?(?:\/([^?]+))?/,
  );
  if (!m) {
    throw new Error(
      "SUPABASE_DB_URL must look like postgres://user:password@host[:port]/database",
    );
  }
  const [, user, password, host, port, database] = m;
  return {
    user,
    password,
    host,
    port: port ? Number(port) : 5432,
    database: database || "postgres",
  };
}

function getPool(): pg.Pool {
  if (!DB_URL) {
    throw new Error("SUPABASE_DB_URL is not set");
  }
  if (!pool) {
    pool = new pg.Pool({
      ...parseDbUrl(DB_URL),
      // Full TLS verification against the pinned Supabase root (the pooler's
      // self-signed root is not in the system trust store). See ./supabase-ca.
      ssl: { ca: SUPABASE_ROOT_CA_2021, rejectUnauthorized: true },
      max: 2,
      // Time-bound a slow/hung pooler so a stall fails over to Airtable fast.
      connectionTimeoutMillis: 3000,
      query_timeout: 4000,
      statement_timeout: 4000,
      idleTimeoutMillis: 10000,
      allowExitOnIdle: true,
      keepAlive: true,
    });
    // Without this listener pg escalates an idle-client error to an uncaught
    // exception that would crash the server. Log and swallow; the next query
    // reconnects.
    pool.on("error", (err) => {
      console.error("[supabase] idle pg client error:", err.message);
    });
  }
  return pool;
}

/** True when SUPABASE_DB_URL is configured (so the Supabase path is usable). */
export function hasSupabaseDbUrl(): boolean {
  return Boolean(DB_URL);
}

/**
 * Race a read against SUPABASE_READ_TIMEOUT_MS so a stall at connect / TLS /
 * query rejects fast and lands in the caller's Airtable fallback. Every public
 * reader below goes through this — a hung pooler must never hang the dashboard.
 */
async function withTimeout<T>(label: string, read: Promise<T>): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(
      () =>
        reject(
          new Error(
            `Supabase read (${label}) timed out after ${SUPABASE_READ_TIMEOUT_MS}ms`,
          ),
        ),
      SUPABASE_READ_TIMEOUT_MS,
    );
  });
  try {
    return await Promise.race([read, timeout]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

/**
 * Build a fields object from a row, emitting a key only when the column value
 * is non-null. This reproduces Airtable's sparse-record shape (Airtable omits
 * empty cells from `fields`), which the dashboard relies on to render "—"
 * instead of 0 for never-populated columns (e.g. Website Clicks, Impressions).
 * A SQL 0 is a real value and IS emitted; only null is dropped.
 */
function buildFields(
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
function toCreatedTime(updatedAt: unknown): string {
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
// pg returns numeric as a string; we Number() it so the envelope matches
// Airtable's numeric type, then num() in the components parses it identically.
const DAILY_MAP: Array<[string, string]> = [
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

export async function getDailyAccountMetricsFromSupabase(): Promise<
  AirtableRecord[]
> {
  return withTimeout(
    "daily_account_metrics",
    (async () => {
      const { rows } = await getPool().query(
        `select date, platform, followers, followers_gained, impressions,
                reach, profile_views, website_clicks, engagement_rate, er_type,
                updated_at
           from social.daily_account_metrics
          order by date desc`,
      );
      return rows.map((r) => {
        const fields = buildFields(r, DAILY_MAP);
        // numeric -> JS number (fraction). num() tolerates strings too, but a
        // Number matches Airtable's stored type for exact parity-test equality.
        if ("Engagement Rate" in fields) {
          fields["Engagement Rate"] = Number(fields["Engagement Rate"]);
        }
        return {
          // Stable synthetic id: one row per platform per day.
          id: `${r.platform}|${r.date}`,
          fields,
          createdTime: toCreatedTime(r.updated_at),
        };
      });
    })(),
  );
}

// ---------------------------------------------------------------------------
// social.weekly_summaries -> getWeeklySummaries
// ---------------------------------------------------------------------------
const WEEKLY_MAP: Array<[string, string]> = [
  ["week_start", "Week Start"],
  ["period", "Period"],
  ["posts_analysed", "Posts Analysed"],
  ["full_report", "Full Report"],
  ["top_post", "Top Post"],
  ["platform_breakdown", "Platform Breakdown"],
];

export async function getWeeklySummariesFromSupabase(): Promise<
  AirtableRecord[]
> {
  return withTimeout(
    "weekly_summaries",
    (async () => {
      const { rows } = await getPool().query(
        `select week_start, period, posts_analysed, full_report, top_post,
                platform_breakdown, updated_at
           from social.weekly_summaries
          order by week_start desc`,
      );
      return rows.map((r) => ({
        // No natural id column; one summary per week -> synthesize from
        // week_start (the component takes summaries[0], so the desc sort above
        // is what's load-bearing, not the id).
        id: `week|${r.week_start}`,
        fields: buildFields(r, WEEKLY_MAP),
        createdTime: toCreatedTime(r.updated_at),
      }));
    })(),
  );
}

// ---------------------------------------------------------------------------
// social.social_alerts -> getSocialAlerts
// ---------------------------------------------------------------------------
const ALERTS_MAP: Array<[string, string]> = [
  ["alert_date", "Alert Date"],
  ["platform", "Platform"],
  ["type", "Type"],
  ["severity", "Severity"],
  ["message", "Message"],
  ["post_id", "Post ID"],
];

export async function getSocialAlertsFromSupabase(): Promise<AirtableRecord[]> {
  return withTimeout(
    "social_alerts",
    (async () => {
      const { rows } = await getPool().query(
        `select id, alert_date, platform, type, severity, message, post_id,
                updated_at
           from social.social_alerts
          order by alert_date desc, id desc`,
      );
      return rows.map((r) => ({
        // Real bigint id -> string (envelope ids are strings; AlertsFeed uses
        // it as the React key). int8 was parsed to a JS number above.
        id: String(r.id),
        fields: buildFields(r, ALERTS_MAP),
        createdTime: toCreatedTime(r.updated_at),
      }));
    })(),
  );
}
