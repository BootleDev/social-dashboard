const BASE_URL = "https://api.airtable.com/v0";

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

async function fetchAllRecords(
  tableId: string,
  options: {
    filterByFormula?: string;
    sort?: Array<{ field: string; direction: "asc" | "desc" }>;
    fields?: string[];
    maxRecords?: number;
    noCache?: boolean;
  } = {},
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
    // MARKETING-19 Fix 7: when noCache is set (Refresh button path), bypass
    // the 30-min Next.js fetch cache by setting cache: 'no-store'. Default
    // behaviour keeps the 30-min revalidate window for normal dashboard loads.
    const fetchOptions: RequestInit = options.noCache
      ? {
          headers: { Authorization: `Bearer ${apiKey}` },
          cache: "no-store",
        }
      : {
          headers: { Authorization: `Bearer ${apiKey}` },
          next: { revalidate: 1800 },
        };
    const res = await fetch(url, fetchOptions);

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

export async function getPosts(opts: { noCache?: boolean } = {}) {
  return fetchAllRecords(TABLES.POSTS, {
    sort: [{ field: "Published At", direction: "desc" }],
    noCache: opts.noCache,
  });
}

export async function getDailyAccountMetrics(opts: { noCache?: boolean } = {}) {
  return fetchAllRecords(TABLES.DAILY_ACCOUNT_METRICS, {
    sort: [{ field: "Date", direction: "desc" }],
    noCache: opts.noCache,
  });
}

/**
 * WEBDEV-146: account-level daily facts (one row per platform|date) with
 * per-metric Source provenance columns. Sorted newest-first, like the legacy
 * Daily Account Metrics. This is the SOLE source for account-grain KPIs (see the
 * per-grain source model comment at the top of this file). Populated for IG/FB
 * by the Meta Social Data Refresher; Pinterest rows arrive with MARKETING-35.
 */
export async function getAccountDailyFacts(opts: { noCache?: boolean } = {}) {
  return fetchAllRecords(TABLES.ACCOUNT_DAILY_FACTS, {
    sort: [{ field: "Date", direction: "desc" }],
    noCache: opts.noCache,
  });
}

export async function getWeeklySummaries(opts: { noCache?: boolean } = {}) {
  return fetchAllRecords(TABLES.WEEKLY_SUMMARIES, {
    sort: [{ field: "Week Start", direction: "desc" }],
    noCache: opts.noCache,
  });
}

export async function getSocialAlerts(opts: { noCache?: boolean } = {}) {
  return fetchAllRecords(TABLES.SOCIAL_ALERTS, {
    sort: [{ field: "Alert Date", direction: "desc" }],
    noCache: opts.noCache,
  });
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
