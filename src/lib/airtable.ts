import {
  hasSupabaseDbUrl,
  getDailyAccountMetricsFromSupabase,
  getWeeklySummariesFromSupabase,
  getSocialAlertsFromSupabase,
  getAccountDailyFactsFromSupabase,
} from "./supabase";
import {
  forcedToAirtable,
  hasAllExpectedPlatforms,
  EXPECTED_ACCOUNT_PLATFORMS,
} from "./sourceSwitch";
import { createTtlCache } from "./ttlCache";

const BASE_URL = "https://api.airtable.com/v0";

/**
 * Result cache for table reads. Caches the PARSED records, not the raw HTTP
 * responses — Next.js's per-fetch Data Cache caps a single entry at 2 MB and
 * the Pinterest-trends / Instagram-audience feeds now exceed that, which made
 * the cached fetch path throw and 500 the dashboard on normal loads. A 30-min
 * in-process TTL here preserves the old caching behaviour without the size cap.
 * The Refresh button (noCache) forces a refresh that writes through.
 */
const TABLE_CACHE_TTL_MS = 1800_000; // 30 minutes, matching the prior revalidate.
const tableCache = createTtlCache({ ttlMs: TABLE_CACHE_TTL_MS });

/**
 * Per-grain data-source model (WEBDEV-146, decided 2026-06-02). Read this before
 * changing where the dashboard sources account-level KPIs.
 *
 *  - ACCOUNT-grain KPIs (Followers, Reach, Impressions, ER) come ONLY from
 *    `Account Daily Facts` (ACCOUNT_DAILY_FACTS). The legacy `Daily Account
 *    Metrics` table (DAILY_ACCOUNT_METRICS) is retired for account KPIs — it is
 *    no longer read by the Overview/Pulse aggregation. It remains in TABLES only
 *    for any non-KPI legacy reader.
 *  - POST/PIN-grain metrics come from the Posts table (and, once populated,
 *    `Post Daily Facts`). For IG/FB these are NEVER summed into an account
 *    headline — a post-sum over-counts deduplicated account reach.
 *  - PINTEREST account reach/impressions: Pinterest exposes no deduplicated
 *    account reach, so its account row in `Account Daily Facts` carries a
 *    deliberate pin-impression SUM, tagged with a distinct Source value
 *    (`pin_sum`) so it is never mistaken for a Meta-style measurement. That
 *    write is MARKETING-35; until it lands, `Account Daily Facts` has no
 *    Pinterest rows, so Pinterest account reach/impressions are simply absent
 *    on the dashboard (intentional single-source behaviour, not a bug).
 *  - Structurally-absent cells (FB account Reach, IG account Impressions) are
 *    omitted, never shown as 0 or a synthetic substitute — the platform APIs
 *    don't report them.
 *
 * The in-app Methodology page explains this for dashboard readers; this comment
 * is the dev-facing copy of the same model.
 */

export const TABLES = {
  POSTS: "tbljDi7YY46pQkQGH",
  DAILY_ACCOUNT_METRICS: "tblGnvjSCdr1zttJe",
  WEEKLY_SUMMARIES: "tblUinLyGAkmneFFZ",
  SOCIAL_ALERTS: "tbliPoyQSWCMmF5FH",
  CONTENT_LIBRARY: "tbl5IMvmWyqGfuwSv",
  // Per-channel data feeds. One table per (channel, data-type) pair.
  // Naming convention: {CHANNEL}_{DATA_TYPE}. Add new feeds here as we wire them.
  INSTAGRAM_AUDIENCE: "tblB8T1Cy0H8OzVXG",
  PINTEREST_TRENDS_KEYWORDS: "tblZ4f4TXc92jakq8",
  PINTEREST_TOP_PINS: "tblEuz0kmposwh81J",
  SEASONAL_OPPORTUNITIES: "tbl5z2eAZakyz3ZZh",
  // WEBDEV-146: append-only daily-facts model (one row per platform|date, with
  // per-metric Source provenance). Source of truth that DAILY_ACCOUNT_METRICS
  // becomes a derived rollup of. Populated by the Social Data Refresher.
  ACCOUNT_DAILY_FACTS: "tblgKAMI1pF3FjQGo",
  POST_DAILY_FACTS: "tblz1pSPb5ByXZMHe",
} as const;

interface AirtableRecord {
  id: string;
  fields: Record<string, unknown>;
  createdTime: string;
}

interface AirtableResponse {
  records: AirtableRecord[];
  offset?: string;
}

function getCredentials(): { baseId: string; apiKey: string } {
  const baseId = process.env.AIRTABLE_BASE_ID;
  const apiKey = process.env.AIRTABLE_API_KEY;
  if (!baseId || !apiKey) {
    throw new Error(
      "Missing Airtable credentials (AIRTABLE_BASE_ID or AIRTABLE_API_KEY)",
    );
  }
  return { baseId, apiKey };
}

interface FetchOptions {
  filterByFormula?: string;
  sort?: Array<{ field: string; direction: "asc" | "desc" }>;
  fields?: string[];
  maxRecords?: number;
  noCache?: boolean;
}

/** Stable cache key for a table read: anything that changes the result set. */
function cacheKeyFor(tableId: string, options: FetchOptions): string {
  return JSON.stringify({
    tableId,
    filterByFormula: options.filterByFormula ?? null,
    sort: options.sort ?? null,
    fields: options.fields ?? null,
    maxRecords: options.maxRecords ?? null,
  });
}

/**
 * Read every record from a table, paging through Airtable's offset cursor.
 * Always fetches `no-store`; result caching is handled one level up by the
 * in-process TTL cache (see fetchAllRecords), which avoids Next's 2 MB
 * per-fetch Data Cache cap that the largest feeds now exceed.
 */
async function fetchAllRecordsUncached(
  tableId: string,
  options: FetchOptions,
): Promise<AirtableRecord[]> {
  const { baseId, apiKey } = getCredentials();
  const allRecords: AirtableRecord[] = [];
  let offset: string | undefined;

  do {
    const params = new URLSearchParams();
    if (options.filterByFormula)
      params.set("filterByFormula", options.filterByFormula);
    if (options.maxRecords)
      params.set("maxRecords", String(options.maxRecords));
    if (offset) params.set("offset", offset);

    if (options.sort) {
      options.sort.forEach((s, i) => {
        params.set(`sort[${i}][field]`, s.field);
        params.set(`sort[${i}][direction]`, s.direction);
      });
    }

    if (options.fields) {
      options.fields.forEach((f) => params.append("fields[]", f));
    }

    const url = `${BASE_URL}/${baseId}/${tableId}?${params.toString()}`;
    const res = await fetch(url, {
      headers: { Authorization: `Bearer ${apiKey}` },
      cache: "no-store",
    });

    if (!res.ok) {
      const err = await res.text();
      throw new Error(`Airtable error ${res.status}: ${err}`);
    }

    const data: AirtableResponse = await res.json();
    allRecords.push(...data.records);
    offset = data.offset;
  } while (offset);

  return allRecords;
}

/**
 * Cached table read. Serves a parsed result from the 30-min in-process TTL
 * cache; `noCache` (the Refresh button) forces a fresh read that writes
 * through. This replaces the previous `next: { revalidate }` per-fetch caching,
 * which 500'd once a feed's response exceeded Next's 2 MB cached-entry cap.
 */
async function fetchAllRecords(
  tableId: string,
  options: FetchOptions = {},
): Promise<AirtableRecord[]> {
  return tableCache.get(
    cacheKeyFor(tableId, options),
    () => fetchAllRecordsUncached(tableId, options),
    { forceRefresh: options.noCache },
  );
}

export async function getPosts(opts: { noCache?: boolean } = {}) {
  return fetchAllRecords(TABLES.POSTS, {
    sort: [{ field: "Published At", direction: "desc" }],
    noCache: opts.noCache,
  });
}

// ---------------------------------------------------------------------------
// WEBDEV-207 (dashboard cutover): three getters are repointed to Supabase, each
// behind a per-table kill switch and each FAIL-CLOSED to the original Airtable
// read on ANY error, timeout, or empty result. The Supabase reads return the
// SAME { id, fields:{<Airtable display names>}, createdTime } envelope, so the
// /api routes and components are untouched. POSTS and CONTENT_LIBRARY are NOT
// migrated (human-edited) and stay on Airtable below.
//
// Per-table kill switches (force Airtable even when SUPABASE_DB_URL is present):
//   DAILY_METRICS_SOURCE=airtable
//   WEEKLY_SUMMARIES_SOURCE=airtable
//   SOCIAL_ALERTS_SOURCE=airtable
//   ACCOUNT_DAILY_FACTS_SOURCE=airtable   (WEBDEV-228; expires when WEBDEV-216
//                                          retires the Airtable dual-write)
// ---------------------------------------------------------------------------

// forcedToAirtable lives in ./sourceSwitch (pure, unit-tested): whitespace-
// and case-insensitive "airtable" match, warns on any other non-empty value
// (WEBDEV-210 port of the ad-dashboard hardening — a Vercel-pasted
// "airtable\n" must still roll back).

async function getDailyAccountMetricsFromAirtable(opts: { noCache?: boolean }) {
  return fetchAllRecords(TABLES.DAILY_ACCOUNT_METRICS, {
    sort: [{ field: "Date", direction: "desc" }],
    noCache: opts.noCache,
  });
}

export async function getDailyAccountMetrics(opts: { noCache?: boolean } = {}) {
  if (
    !forcedToAirtable(process.env.DAILY_METRICS_SOURCE, "DAILY_METRICS_SOURCE") &&
    hasSupabaseDbUrl()
  ) {
    try {
      const rows = await getDailyAccountMetricsFromSupabase();
      if (rows.length > 0) return rows;
      console.warn(
        "[daily-metrics] Supabase returned no rows; falling back to Airtable",
      );
    } catch (err) {
      console.error(
        "[daily-metrics] Supabase read failed; falling back to Airtable:",
        err instanceof Error ? err.message : err,
      );
    }
  }
  return getDailyAccountMetricsFromAirtable(opts);
}

async function getWeeklySummariesFromAirtable(opts: { noCache?: boolean }) {
  return fetchAllRecords(TABLES.WEEKLY_SUMMARIES, {
    sort: [{ field: "Week Start", direction: "desc" }],
    noCache: opts.noCache,
  });
}

export async function getWeeklySummaries(opts: { noCache?: boolean } = {}) {
  if (
    !forcedToAirtable(
      process.env.WEEKLY_SUMMARIES_SOURCE,
      "WEEKLY_SUMMARIES_SOURCE",
    ) &&
    hasSupabaseDbUrl()
  ) {
    try {
      const rows = await getWeeklySummariesFromSupabase();
      if (rows.length > 0) return rows;
      console.warn(
        "[weekly-summaries] Supabase returned no rows; falling back to Airtable",
      );
    } catch (err) {
      console.error(
        "[weekly-summaries] Supabase read failed; falling back to Airtable:",
        err instanceof Error ? err.message : err,
      );
    }
  }
  return getWeeklySummariesFromAirtable(opts);
}

async function getSocialAlertsFromAirtable(opts: { noCache?: boolean }) {
  return fetchAllRecords(TABLES.SOCIAL_ALERTS, {
    sort: [{ field: "Alert Date", direction: "desc" }],
    noCache: opts.noCache,
  });
}

export async function getSocialAlerts(opts: { noCache?: boolean } = {}) {
  if (
    !forcedToAirtable(process.env.SOCIAL_ALERTS_SOURCE, "SOCIAL_ALERTS_SOURCE") &&
    hasSupabaseDbUrl()
  ) {
    try {
      const rows = await getSocialAlertsFromSupabase();
      if (rows.length > 0) return rows;
      console.warn(
        "[social-alerts] Supabase returned no rows; falling back to Airtable",
      );
    } catch (err) {
      console.error(
        "[social-alerts] Supabase read failed; falling back to Airtable:",
        err instanceof Error ? err.message : err,
      );
    }
  }
  return getSocialAlertsFromAirtable(opts);
}

/**
 * WEBDEV-146: account-level daily facts (one row per platform|date) with
 * per-metric Source provenance columns. Sorted newest-first, like the legacy
 * Daily Account Metrics. This is the SOLE source for account-grain KPIs (see the
 * per-grain source model comment at the top of this file). Populated for IG/FB
 * by the Meta Social Data Refresher; Pinterest rows arrive with MARKETING-35.
 */
async function getAccountDailyFactsFromAirtable(opts: { noCache?: boolean }) {
  return fetchAllRecords(TABLES.ACCOUNT_DAILY_FACTS, {
    sort: [{ field: "Date", direction: "desc" }],
    noCache: opts.noCache,
  });
}

export async function getAccountDailyFacts(opts: { noCache?: boolean } = {}) {
  // NOTE: this kill switch expires when WEBDEV-216 removes the Airtable
  // dual-write — after that the Airtable fallback below serves nothing.
  if (
    !forcedToAirtable(
      process.env.ACCOUNT_DAILY_FACTS_SOURCE,
      "ACCOUNT_DAILY_FACTS_SOURCE",
    ) &&
    hasSupabaseDbUrl()
  ) {
    try {
      const rows = await getAccountDailyFactsFromSupabase();
      // Two independent writers (Social + Pinterest refreshers) populate this
      // table, so `rows.length > 0` alone would accept a Supabase-side write gap
      // for one platform and silently drop its KPIs. Require EVERY expected
      // platform present; otherwise fall back to Airtable. (When BOTH stores are
      // stale the reconciler + OpsPanel freshness own it — fallback can't help.)
      if (hasAllExpectedPlatforms(rows)) return rows;
      console.warn(
        "[account-daily-facts] Supabase empty or missing platform(s); " +
          `falling back to Airtable (expected ${EXPECTED_ACCOUNT_PLATFORMS.join(", ")})`,
      );
    } catch (err) {
      console.error(
        "[account-daily-facts] Supabase read failed; falling back to Airtable:",
        err instanceof Error ? err.message : err,
      );
    }
  }
  return getAccountDailyFactsFromAirtable(opts);
}

export async function getContentLibrary(opts: { noCache?: boolean } = {}) {
  return fetchAllRecords(TABLES.CONTENT_LIBRARY, {
    sort: [{ field: "Views", direction: "desc" }],
    maxRecords: 100,
    noCache: opts.noCache,
  });
}

export async function getInstagramAudience(opts: { noCache?: boolean } = {}) {
  return fetchAllRecords(TABLES.INSTAGRAM_AUDIENCE, {
    sort: [
      { field: "Snapshot Date", direction: "desc" },
      { field: "Value", direction: "desc" },
    ],
    noCache: opts.noCache,
  });
}

export async function getPinterestTrendsKeywords(
  opts: { noCache?: boolean } = {},
) {
  return fetchAllRecords(TABLES.PINTEREST_TRENDS_KEYWORDS, {
    sort: [
      { field: "Snapshot Date", direction: "desc" },
      { field: "Rank", direction: "asc" },
    ],
    noCache: opts.noCache,
  });
}

export async function getPinterestTopPins(opts: { noCache?: boolean } = {}) {
  return fetchAllRecords(TABLES.PINTEREST_TOP_PINS, {
    sort: [
      { field: "Snapshot Date", direction: "desc" },
      { field: "Rank", direction: "asc" },
    ],
    noCache: opts.noCache,
  });
}

/**
 * PATCH a single Posts record by Airtable record id. Used by the Insights
 * drilldown's inline tag editor. typecheckedAt boundary; the route handler
 * is responsible for whitelisting which fields can be written.
 */
export async function updatePostRecord(
  recordId: string,
  fields: Record<string, unknown>,
): Promise<AirtableRecord> {
  const { baseId, apiKey } = getCredentials();
  const url = `${BASE_URL}/${baseId}/${TABLES.POSTS}/${recordId}`;
  const res = await fetch(url, {
    method: "PATCH",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ fields, typecast: false }),
    cache: "no-store",
  });
  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Airtable PATCH ${res.status}: ${err}`);
  }
  return (await res.json()) as AirtableRecord;
}

export async function getSeasonalOpportunities(
  opts: { noCache?: boolean } = {},
) {
  return fetchAllRecords(TABLES.SEASONAL_OPPORTUNITIES, {
    noCache: opts.noCache,
  });
}

export async function getAllDashboardData(opts: { noCache?: boolean } = {}) {
  const [
    posts,
    dailyMetrics,
    accountDailyFacts,
    weeklySummaries,
    alerts,
    instagramAudience,
    pinterestTrends,
    pinterestTopPins,
    seasonalOpportunities,
  ] = await Promise.all([
    getPosts(opts),
    // Legacy table: still fetched for any non-KPI legacy reader, but NOT the
    // source of account-grain KPIs anymore (see top-of-file source model).
    getDailyAccountMetrics(opts),
    // Sole source for account-grain KPIs (WEBDEV-146).
    getAccountDailyFacts(opts),
    getWeeklySummaries(opts),
    getSocialAlerts(opts),
    getInstagramAudience(opts),
    getPinterestTrendsKeywords(opts),
    getPinterestTopPins(opts),
    getSeasonalOpportunities(opts),
  ]);

  return {
    posts,
    dailyMetrics,
    accountDailyFacts,
    weeklySummaries,
    alerts,
    instagramAudience,
    pinterestTrends,
    pinterestTopPins,
    seasonalOpportunities,
  };
}
