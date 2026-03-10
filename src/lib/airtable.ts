const BASE_URL = "https://api.airtable.com/v0";
const BASE_ID = process.env.AIRTABLE_BASE_ID!;
const API_KEY = process.env.AIRTABLE_API_KEY!;

export const TABLES = {
  POSTS: "tbljDi7YY46pQkQGH",
  DAILY_ACCOUNT_METRICS: "tblGnvjSCdr1zttJe",
  WEEKLY_SUMMARIES: "tblUinLyGAkmneFFZ",
  SOCIAL_ALERTS: "tbliPoyQSWCMmF5FH",
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

async function fetchAllRecords(
  tableId: string,
  options: {
    filterByFormula?: string;
    sort?: Array<{ field: string; direction: "asc" | "desc" }>;
    fields?: string[];
    maxRecords?: number;
  } = {},
): Promise<AirtableRecord[]> {
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

    const url = `${BASE_URL}/${BASE_ID}/${tableId}?${params.toString()}`;
    const res = await fetch(url, {
      headers: { Authorization: `Bearer ${API_KEY}` },
      next: { revalidate: 1800 },
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

export async function getPosts() {
  return fetchAllRecords(TABLES.POSTS, {
    sort: [{ field: "Published At", direction: "desc" }],
  });
}

export async function getDailyAccountMetrics() {
  return fetchAllRecords(TABLES.DAILY_ACCOUNT_METRICS, {
    sort: [{ field: "Date", direction: "desc" }],
  });
}

export async function getWeeklySummaries() {
  return fetchAllRecords(TABLES.WEEKLY_SUMMARIES, {
    sort: [{ field: "Week Start", direction: "desc" }],
  });
}

export async function getSocialAlerts() {
  return fetchAllRecords(TABLES.SOCIAL_ALERTS, {
    sort: [{ field: "Alert Date", direction: "desc" }],
  });
}

export async function getAllDashboardData() {
  const [posts, dailyMetrics, weeklySummaries, alerts] = await Promise.all([
    getPosts(),
    getDailyAccountMetrics(),
    getWeeklySummaries(),
    getSocialAlerts(),
  ]);

  return { posts, dailyMetrics, weeklySummaries, alerts };
}
