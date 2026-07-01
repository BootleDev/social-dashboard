import "server-only";
import type { DailyAdRow, ShopifySalesRow, AdSnapshotRow } from "./adBaseline";
import { num, str, count, numNonNeg } from "./utils";
import { getMarketingDailyAggregatesFromSupabase } from "./supabase";

/**
 * Reader for the paid simulator's baseline history — the measured paid-ad +
 * Shopify sales rows that feed adBaseline.
 *
 * WEBDEV-216 Phase 3: the daily ad aggregates now come from the Supabase VIEW
 * marketing.daily_aggregates (see ./supabase.getMarketingDailyAggregatesFromSupabase),
 * NOT the Airtable "Daily Aggregates" table. The remaining two reads — Shopify
 * Daily Sales and Ad Snapshots — still come from the Airtable "Marketing
 * Intelligence" base (a SEPARATE base from the social-intelligence base used by
 * airtable.ts, so its own base id, overridable via env; reuses the same API
 * key), because those tables have other readers not yet migrated
 * (WEBDEV-371/373/377).
 *
 * Maps rows to the minimal DailyAdRow / ShopifySalesRow shapes the pure lib
 * expects. Rates in the Airtable base are stored as DECIMAL fractions despite
 * Airtable's "percent" field type (verified against live data: 0.039 = 3.9%),
 * so no scaling is applied here.
 */

const BASE_URL = "https://api.airtable.com/v0";

/** Marketing Intelligence base id (env override, else the known prod base). */
export const MARKETING_BASE_ID =
  process.env.MARKETING_AIRTABLE_BASE_ID ?? "appIyePhrYZBUxCP9";

export const MARKETING_TABLES = {
  // DAILY_AGGREGATES retired here (WEBDEV-216 Phase 3) — daily ad aggregates now
  // read from the marketing.daily_aggregates Supabase view. These two remain on
  // Airtable (other readers pending migration, WEBDEV-371/373/377).
  AD_SNAPSHOTS: "tblzn5odeQKZUWNGb",
  SHOPIFY_DAILY_SALES: "tblhMQwAZkF4A293c",
} as const;

interface RawRecord {
  id: string;
  fields: Record<string, unknown>;
  createdTime: string;
}

function apiKey(): string {
  const key = process.env.AIRTABLE_API_KEY;
  if (!key) throw new Error("Missing AIRTABLE_API_KEY for Marketing Intelligence read");
  return key;
}

/** Page through a Marketing Intelligence table, newest first by `dateField`. */
async function fetchTable(
  tableId: string,
  dateField: string,
): Promise<RawRecord[]> {
  const records: RawRecord[] = [];
  let offset: string | undefined;
  do {
    const params = new URLSearchParams();
    params.set("sort[0][field]", dateField);
    params.set("sort[0][direction]", "desc");
    if (offset) params.set("offset", offset);
    const url = `${BASE_URL}/${MARKETING_BASE_ID}/${tableId}?${params.toString()}`;
    // Bound each request so a hung Airtable call fails fast instead of stalling
    // the route until the platform's function timeout.
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 8000);
    let res: Response;
    try {
      res = await fetch(url, {
        headers: { Authorization: `Bearer ${apiKey()}` },
        cache: "no-store",
        signal: controller.signal,
      });
    } finally {
      clearTimeout(timer);
    }
    if (!res.ok) {
      throw new Error(`Marketing Intelligence ${res.status}: ${await res.text()}`);
    }
    const data = (await res.json()) as { records: RawRecord[]; offset?: string };
    records.push(...data.records);
    offset = data.offset;
  } while (offset);
  return records;
}

/** Map a Daily Aggregates record to the lib's DailyAdRow shape. */
function toDailyAdRow(r: RawRecord): DailyAdRow {
  return {
    date: str(r.fields["Date"]),
    spend: num(r.fields["Total Spend"]),
    impressions: count(r.fields["Impressions"]),
    clicks: count(r.fields["Clicks"]),
    // Modeled ad conversions are fractional — keep the decimals (see numNonNeg).
    purchases: numNonNeg(r.fields["Total Purchases"]),
  };
}

/** Map a Shopify Daily Sales record to the lib's ShopifySalesRow shape. */
function toShopifySalesRow(r: RawRecord): ShopifySalesRow {
  return {
    date: str(r.fields["Date"]),
    orders: count(r.fields["Total Orders"]),
    grossRevenue: num(r.fields["Gross Revenue"]),
    // Net Revenue + Total Discounts let us exclude 100%-off comp/test orders
    // (net <= 0 or discount >= gross) that would otherwise drag AOV down.
    netRevenue: num(r.fields["Net Revenue"]),
    totalDiscounts: num(r.fields["Total Discounts"]),
    currency: str(r.fields["Currency"]) || "EUR",
  };
}

/** Map an Ad Snapshots record to the lib's AdSnapshotRow shape (ad-attributed). */
function toAdSnapshotRow(r: RawRecord): AdSnapshotRow {
  return {
    date: str(r.fields["Snapshot Date"]),
    clicks: count(r.fields["Clicks"]),
    // Modeled ad conversions are fractional — keep the decimals so the count
    // denominator stays consistent with the (already-fractional) Purchase Value.
    purchases: numNonNeg(r.fields["Purchases"]),
    purchaseValue: num(r.fields["Purchase Value"]),
  };
}

export interface MarketingBaselineData {
  daily: DailyAdRow[];
  shopify: ShopifySalesRow[];
  adSnapshots: AdSnapshotRow[];
}

/** Fetch the rows needed to estimate a paid baseline. */
export async function getMarketingBaselineData(): Promise<MarketingBaselineData> {
  // daily -> Supabase (marketing.daily_aggregates view); shopify + adSnapshots
  // stay on Airtable. The Supabase getter returns the same { id, fields:{…} }
  // envelope, so toDailyAdRow is unchanged.
  const [dailyRaw, shopifyRaw, adRaw] = await Promise.all([
    getMarketingDailyAggregatesFromSupabase(),
    fetchTable(MARKETING_TABLES.SHOPIFY_DAILY_SALES, "Date"),
    fetchTable(MARKETING_TABLES.AD_SNAPSHOTS, "Snapshot Date"),
  ]);
  return {
    daily: dailyRaw.map(toDailyAdRow),
    shopify: shopifyRaw.map(toShopifySalesRow),
    adSnapshots: adRaw.map(toAdSnapshotRow),
  };
}
