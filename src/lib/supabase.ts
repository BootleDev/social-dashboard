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
import { mapDailyRow, mapWeeklyRow, mapAlertRow } from "./supabaseMappers";
import { assertFractionScale } from "./rateSentinel";

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
      // NOTE: the connect (2500) and query (3500) budgets are SEQUENTIAL, so
      // they do NOT individually sit under the 4000ms ceiling. The actual
      // guarantee: failover is guaranteed at 4000ms by the Promise.race in
      // withTimeout(); an orphaned in-flight query is then destroyed by
      // query_timeout, bounded at ~6s worst case (2500 connect + 3500 query),
      // briefly holding one of the pool's 2 slots after the failover.
      connectionTimeoutMillis: 2500,
      query_timeout: 3500,
      statement_timeout: 3500,
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

// The pure row -> envelope mappers (and their column->display-name maps) live
// in ./supabaseMappers so they can be unit-tested without this server-only / pg
// connection layer. The #1 review risk — the engagement-rate fraction-vs-percent
// invariant and the exact emitted key set / id synthesis / sparse-shape rule —
// is locked there by supabaseMappers.test.ts. Each getter below just runs the
// query and maps each row through the matching pure mapper.

// ---------------------------------------------------------------------------
// social.daily_account_metrics -> getDailyAccountMetrics
// ---------------------------------------------------------------------------
//
// ENGAGEMENT-RATE UNIT (the #1 review risk): engagement_rate is stored as a
// FRACTION (e.g. 0.0870 = 8.70%), identical to how Airtable's daily metrics
// stored it. The Overview / PlatformCompare ER trend charts do
// num(fields['Engagement Rate']) * 100 and plot that on the SAME axis as the
// Airtable POSTS-derived ER line (which is also a fraction * 100). So we MUST
// pass the fraction through unchanged — converting to a percent here would
// render the migrated daily ER 100x too large against the unchanged posts line.
// pg returns numeric as a string; mapDailyRow passes it through verbatim and
// num() in the components parses that string identically to a JS number, so no
// coercion is needed here. The invariant is asserted in supabaseMappers.test.ts.
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
      // Runtime unit-scale tripwire (WEBDEV-210): percent-scale drift on
      // engagement_rate throws here, landing in getDailyAccountMetrics()'s
      // catch -> Airtable fallback. Counts are never listed. idCols is the
      // composite key (one row per platform per day).
      assertFractionScale("social.daily_account_metrics", rows, {
        throwOn: ["engagement_rate"],
        idCols: ["platform", "date"],
      });
      return rows.map(mapDailyRow);
    })(),
  );
}

// ---------------------------------------------------------------------------
// social.weekly_summaries -> getWeeklySummaries
// ---------------------------------------------------------------------------
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
      return rows.map(mapWeeklyRow);
    })(),
  );
}

// ---------------------------------------------------------------------------
// social.social_alerts -> getSocialAlerts
// ---------------------------------------------------------------------------
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
      return rows.map(mapAlertRow);
    })(),
  );
}
