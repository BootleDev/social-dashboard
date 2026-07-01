import {
  getDailyAccountMetricsFromSupabase,
  getWeeklySummariesFromSupabase,
  getSocialAlertsFromSupabase,
  getAccountDailyFactsFromSupabase,
} from "./supabase";
import {
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
 *    `Account Daily Facts`. The legacy `Daily Account Metrics` table is retired
 *    for account KPIs — it is no longer read by the Overview/Pulse aggregation.
 *    It is still exposed via getDailyAccountMetrics (now sourced from Supabase,
 *    WEBDEV-216) for any non-KPI legacy reader.
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
 *  - IG account Impressions is structurally absent (Meta retired it) — omitted,
 *    never shown as 0 or a synthetic substitute, because the API doesn't report
 *    it. FB has no deduplicated account Reach either, so from 2026-06-20 FB Reach
 *    is a `page_total_media_view_unique` proxy (Source `daily_proxy`) — counted,
 *    but disclosed as a proxy on the Methodology page.
 *
 * The in-app Methodology page explains this for dashboard readers; this comment
 * is the dev-facing copy of the same model.
 */

export const TABLES = {
  POSTS: "tbljDi7YY46pQkQGH",
  CONTENT_LIBRARY: "tbl5IMvmWyqGfuwSv",
  // Per-channel data feeds. One table per (channel, data-type) pair.
  // Naming convention: {CHANNEL}_{DATA_TYPE}. Add new feeds here as we wire them.
  INSTAGRAM_AUDIENCE: "tblB8T1Cy0H8OzVXG",
  PINTEREST_TRENDS_KEYWORDS: "tblZ4f4TXc92jakq8",
  PINTEREST_TOP_PINS: "tblEuz0kmposwh81J",
  SEASONAL_OPPORTUNITIES: "tbl5z2eAZakyz3ZZh",
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
// WEBDEV-216 (dashboard, Supabase-only): the four machine-written tables below
// are served straight from Supabase — the Airtable dual-write and the fail-
// closed Airtable fallback (WEBDEV-207/228) are retired. The Supabase reads
// return the SAME { id, fields:{<Airtable display names>}, createdTime }
// envelope, so the /api routes and components are untouched. A Supabase read
// error now propagates to the caller (route 500 / error state) instead of
// falling back. POSTS and CONTENT_LIBRARY are NOT migrated (human-edited) and
// stay on Airtable below.
// ---------------------------------------------------------------------------

// WEBDEV-216: served from Supabase (social.daily_account_metrics). `opts` is
// retained for the call signature; the Supabase reader is per-request-fresh so
// noCache no longer applies.
export async function getDailyAccountMetrics(
  _opts: { noCache?: boolean } = {},
) {
  return getDailyAccountMetricsFromSupabase();
}

// WEBDEV-216: served from Supabase (social.weekly_summaries). `opts` retained
// for the call signature; the Supabase reader is per-request-fresh.
export async function getWeeklySummaries(_opts: { noCache?: boolean } = {}) {
  return getWeeklySummariesFromSupabase();
}

// WEBDEV-216: served from Supabase (social.social_alerts). `opts` retained for
// the call signature; the Supabase reader is per-request-fresh.
export async function getSocialAlerts(_opts: { noCache?: boolean } = {}) {
  return getSocialAlertsFromSupabase();
}

export async function getAccountDailyFacts(_opts: { noCache?: boolean } = {}) {
  // account_daily_facts is written by two independent refreshers (Social:
  // instagram+facebook, Pinterest: pinterest). A partial Supabase write would
  // silently drop a platform's KPIs, so require every expected platform before
  // serving. WEBDEV-216 retired the Airtable fallback: an incomplete read now
  // THROWS (fail-loud -> route 500 / error state) instead of falling back,
  // rather than serving partial KPIs.
  const rows = await getAccountDailyFactsFromSupabase();
  if (!hasAllExpectedPlatforms(rows)) {
    throw new Error(
      `account_daily_facts incomplete: expected platforms ` +
        `${EXPECTED_ACCOUNT_PLATFORMS.join(", ")} but the Supabase read is ` +
        `missing at least one (${rows.length} row(s)). Refusing to serve partial KPIs.`,
    );
  }
  return rows;
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
