import {
  hasSupabaseDbUrl,
  getDailyAccountMetricsFromSupabase,
  getWeeklySummariesFromSupabase,
  getSocialAlertsFromSupabase,
} from "./supabase";
import { forcedToAirtable } from "./sourceSwitch";

const BASE_URL = "https://api.airtable.com/v0";

export const TABLES = {
  POSTS: "tbljDi7YY46pQkQGH",
  DAILY_ACCOUNT_METRICS: "tblGnvjSCdr1zttJe",
  WEEKLY_SUMMARIES: "tblUinLyGAkmneFFZ",
  SOCIAL_ALERTS: "tbliPoyQSWCMmF5FH",
  CONTENT_LIBRARY: "tbl5IMvmWyqGfuwSv",
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

export async function getContentLibrary(opts: { noCache?: boolean } = {}) {
  return fetchAllRecords(TABLES.CONTENT_LIBRARY, {
    sort: [{ field: "Views", direction: "desc" }],
    maxRecords: 100,
    noCache: opts.noCache,
  });
}

export async function getAllDashboardData(opts: { noCache?: boolean } = {}) {
  const [posts, dailyMetrics, weeklySummaries, alerts] = await Promise.all([
    getPosts(opts),
    getDailyAccountMetrics(opts),
    getWeeklySummaries(opts),
    getSocialAlerts(opts),
  ]);

  return { posts, dailyMetrics, weeklySummaries, alerts };
}
