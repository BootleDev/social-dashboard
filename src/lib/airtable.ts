const BASE_URL = "https://api.airtable.com/v0";

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
    weeklySummaries,
    alerts,
    instagramAudience,
    pinterestTrends,
    pinterestTopPins,
    seasonalOpportunities,
  ] = await Promise.all([
    getPosts(opts),
    getDailyAccountMetrics(opts),
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
    weeklySummaries,
    alerts,
    instagramAudience,
    pinterestTrends,
    pinterestTopPins,
    seasonalOpportunities,
  };
}
