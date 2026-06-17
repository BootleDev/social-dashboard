/**
 * Paid-marketing simulator — pooled baseline estimation from real history.
 *
 * Turns sparse, noisy daily ad rows (Airtable "Daily Aggregates") + whole-store
 * Shopify rows ("Shopify Daily Sales") into a measured Baseline the simulator
 * can start from. Pure: takes already-parsed rows, does no I/O.
 *
 * WHY POOLED RATIOS (sum numerators / sum denominators), never mean-of-daily:
 * Bootle's daily data is mostly near-zero spend/purchases. A per-day ratio like
 * spend_d/clicks_d is noisiest exactly on low-volume days, and an unweighted
 * mean of those ratios over-weights them (aggregation bias / Simpson's paradox).
 * The pooled estimator sum(spend)/sum(clicks) is the volume-weighted blended
 * price actually paid across the window — the right point estimate.
 *
 * MINIMUM-VOLUME GUARDS: a pooled estimate is only returned when its
 * denominator clears BASELINE_GUARDS; otherwise the value is undefined with
 * confidence "none" (the caller must override). CVR needs far more volume than
 * price/CTR because at ~1 purchase/day a thin click pool gives a 0/1-luck CVR.
 *
 * AOV CAVEAT (documented assumption): Shopify Daily Sales is WHOLE-STORE, not
 * ad-attributed. windowAOV is therefore the store-wide basket value, used as
 * the assumed value of an incremental ad-driven conversion — a modeling choice,
 * not a measured ad AOV. Uses GROSS revenue (net can go negative from
 * discounts) and EUR rows only (never blend currencies).
 */

import {
  BASELINE_GUARDS,
  type Baseline,
  type BaselineFlags,
  type BaselineWindow,
  type ConversionCounts,
  type Confidence,
  type EstimateWithConfidence,
  type RateInterval,
} from "./adScenario";
import { wilsonInterval } from "./stats";

// ===========================================================================
// Minimal input row shapes (parsed numbers, not Airtable envelopes)
// ===========================================================================

/** One day of account-level ad performance (Daily Aggregates). */
export interface DailyAdRow {
  date: string;
  spend: number;
  impressions: number;
  clicks: number;
  purchases: number;
}

/** One day of whole-store Shopify sales (Shopify Daily Sales). */
export interface ShopifySalesRow {
  date: string;
  orders: number;
  grossRevenue: number;
  /** Revenue after discounts. Optional (older callers omit it). Used to drop
   *  100%-off comp/test days (net <= 0) from AOV. */
  netRevenue?: number;
  /** Discounts applied. Optional. A day with discounts >= gross is a comp day. */
  totalDiscounts?: number;
  currency: string;
}

/**
 * One ad-snapshot row (Ad Snapshots: one ad per day). Carries the ad-attributed
 * conversion numerator + value the same-source funnel needs. `purchaseValue` is
 * the ad-attributed revenue (Meta's reported purchase conversion value), which
 * is the correct AOV basis for an ad conversion (Shopify's whole-store basket
 * over-credits it). Clicks/purchases here reconcile with Daily Aggregates.
 */
export interface AdSnapshotRow {
  date: string;
  clicks: number;
  purchases: number;
  purchaseValue: number;
}

/** Inclusive ISO date window to pool over. */
export interface DateWindow {
  start: string;
  end: string;
}

// ===========================================================================
// Pooling helpers
// ===========================================================================

/** Sum a finite numeric field across rows; non-finite values contribute 0. */
function sumField<T>(rows: ReadonlyArray<T>, pick: (r: T) => number): number {
  let total = 0;
  for (const r of rows) {
    const v = pick(r);
    if (Number.isFinite(v)) total += v;
  }
  return total;
}

/**
 * Build one EstimateWithConfidence from a pooled numerator/denominator and a
 * volume guard. `volume` is the sufficiency measure compared to `floor`
 * (usually the denominator itself, e.g. total clicks). Below the floor the
 * value is undefined ("none"); within lowMultiple× of it, "low"; else "ok".
 * `scale` multiplies the raw ratio (used for CPM, which is per-1000).
 */
function pooledEstimate(
  numerator: number,
  denominator: number,
  volume: number,
  floor: number,
  scale = 1,
): EstimateWithConfidence {
  const confidence: Confidence =
    volume < floor ? "none" : volume < floor * BASELINE_GUARDS.lowMultiple ? "low" : "ok";

  if (confidence === "none" || denominator <= 0) {
    return { value: undefined, n: volume, confidence: confidence === "none" ? "none" : confidence };
  }
  return { value: (numerator / denominator) * scale, n: volume, confidence };
}

/**
 * Cap an estimate's confidence by a SECONDARY count (e.g. the rare numerator).
 * CVR/AOV pass the click/order denominator guard but can still rest on a handful
 * of purchases; if `count` is below `minCount`, downgrade "ok"→"low" so the UI
 * never reads a 5-conversion rate as confident. `n` is overwritten with the
 * binding count so the UI surfaces "CVR from N conversions". Immutable.
 */
function capConfidenceByCount(
  est: EstimateWithConfidence,
  count: number,
  minCount: number,
): EstimateWithConfidence {
  const capped: Confidence =
    est.confidence === "ok" && count < minCount ? "low" : est.confidence;
  return { ...est, confidence: capped, n: count };
}

// ===========================================================================
// Window filtering
// ===========================================================================

/** Keep rows whose ISO `date` falls within [start, end] inclusive. */
function inWindow<T extends { date: string }>(
  rows: ReadonlyArray<T>,
  window: DateWindow,
): T[] {
  return rows.filter((r) => r.date >= window.start && r.date <= window.end);
}

// ===========================================================================
// AOV from Shopify (gross, EUR-only)
// ===========================================================================

interface AovResult {
  estimate: EstimateWithConfidence;
  flags: Pick<
    BaselineFlags,
    | "mixedCurrency"
    | "droppedCurrencyRows"
    | "droppedNegativeGrossRows"
    | "droppedCompRows"
  >;
}

/**
 * Is a Shopify row a 100%-off comp / test order that should not count toward
 * AOV? True when net revenue is present and <= 0, or discounts meet/exceed gross
 * (the order was given away). Conservative: if neither field is present we don't
 * treat it as comp (older callers without the fields are unaffected).
 */
function isCompOrder(r: ShopifySalesRow): boolean {
  if (r.netRevenue !== undefined && Number.isFinite(r.netRevenue) && r.netRevenue <= 0) {
    return true;
  }
  if (
    r.totalDiscounts !== undefined &&
    Number.isFinite(r.totalDiscounts) &&
    r.grossRevenue > 0 &&
    r.totalDiscounts >= r.grossRevenue
  ) {
    return true;
  }
  return false;
}

/**
 * Pool AOV = sum(gross) / sum(orders) over EUR rows with non-negative gross,
 * EXCLUDING 100%-off comp/test orders (net <= 0 or discounts >= gross), which
 * would otherwise drag AOV down toward zero. Non-EUR rows are excluded
 * (currencies must never be blended) and counted; negative-gross rows are
 * corrupt and dropped. Below MIN_ORDERS the AOV is undefined.
 */
function estimateAov(rows: ReadonlyArray<ShopifySalesRow>): AovResult {
  let droppedCurrencyRows = 0;
  let droppedNegativeGrossRows = 0;
  let droppedCompRows = 0;
  const eurRows: ShopifySalesRow[] = [];

  for (const r of rows) {
    if (r.currency !== "EUR") {
      droppedCurrencyRows += 1;
      continue;
    }
    if (!Number.isFinite(r.grossRevenue) || r.grossRevenue < 0) {
      droppedNegativeGrossRows += 1;
      continue;
    }
    if (isCompOrder(r)) {
      droppedCompRows += 1;
      continue;
    }
    eurRows.push(r);
  }

  const totalOrders = sumField(eurRows, (r) => r.orders);
  const totalGross = sumField(eurRows, (r) => r.grossRevenue);
  const estimate = pooledEstimate(
    totalGross,
    totalOrders,
    totalOrders,
    BASELINE_GUARDS.minOrders,
  );

  return {
    estimate,
    flags: {
      mixedCurrency: droppedCurrencyRows > 0,
      droppedCurrencyRows,
      droppedNegativeGrossRows,
      droppedCompRows,
    },
  };
}

// ===========================================================================
// Public: estimateBaseline
// ===========================================================================

/**
 * Pool a measured Baseline over a date window.
 *
 * The conversion funnel is AD-ATTRIBUTED and SAME-SOURCE: CVR and AOV both come
 * from Ad Snapshots (purchases/clicks and purchaseValue/purchases), so the
 * funnel is internally consistent rather than stitching ad-clicks to
 * whole-store Shopify orders. Shopify gives a comparison `shopifyAov` only.
 *
 * Small-sample honesty: CVR and ad-AOV pass the click/order denominator guard
 * but are additionally capped to "low" confidence when the ad PURCHASE count
 * (the rare numerator) is below its floor, and CVR carries a Wilson 95%
 * interval so the genuine uncertainty on a handful of conversions is visible.
 *
 * `adSnapshots` is optional: when omitted, CVR falls back to the Daily
 * Aggregates purchase count and AOV falls back to Shopify (the pre-same-source
 * behaviour), so existing two-arg callers keep working.
 */
export function estimateBaseline(
  dailyRows: ReadonlyArray<DailyAdRow>,
  shopifyRows: ReadonlyArray<ShopifySalesRow>,
  window: DateWindow,
  adSnapshots: ReadonlyArray<AdSnapshotRow> = [],
): Baseline {
  const daily = inWindow(dailyRows, window);
  const shopify = inWindow(shopifyRows, window);
  const ads = inWindow(adSnapshots, window);

  const totalSpend = sumField(daily, (r) => r.spend);
  const totalImpressions = sumField(daily, (r) => r.impressions);
  const totalClicks = sumField(daily, (r) => r.clicks);

  // Price / structural estimates gate on click & impression volume.
  const cpc = pooledEstimate(totalSpend, totalClicks, totalClicks, BASELINE_GUARDS.minClicks);
  const ctr = pooledEstimate(
    totalClicks,
    totalImpressions,
    totalImpressions,
    BASELINE_GUARDS.minImpressions,
  );
  const cpm = pooledEstimate(
    totalSpend,
    totalImpressions,
    totalImpressions,
    BASELINE_GUARDS.minImpressions,
    1000, // CPM is per-1000 impressions
  );

  // --- Ad-attributed conversion funnel (same source) ---
  // Prefer Ad Snapshots; fall back to Daily Aggregates purchases when absent.
  // PHANTOM-CONVERSION FILTER: drop ad-snapshot rows that record a purchase on
  // ZERO clicks (view-through / sync-artifact conversions on a day with no ad
  // traffic). They inflate the purchase count and crush ad-AOV. Verified in the
  // live data (2026-01-25/26 each carried a purchase with 0 clicks / 0 spend).
  const adRows = ads.filter((r) => !(r.purchases > 0 && r.clicks === 0));
  const droppedPhantomConversions = ads.reduce(
    (n, r) => n + (r.purchases > 0 && r.clicks === 0 ? r.purchases : 0),
    0,
  );
  const haveAds = adRows.length > 0;
  const adClicks = haveAds ? sumField(adRows, (r) => r.clicks) : totalClicks;
  const adPurchases = haveAds
    ? sumField(adRows, (r) => r.purchases)
    : sumField(daily, (r) => r.purchases);
  const adPurchaseValue = sumField(adRows, (r) => r.purchaseValue);

  // CVR gates on CLICK volume (the denominator), then its confidence is capped
  // by the rare PURCHASE numerator. The estimate still computes (you need a
  // number); the cap just keeps a thin sample from reading "ok".
  const clickCvrRaw = pooledEstimate(
    adPurchases,
    adClicks,
    adClicks,
    BASELINE_GUARDS.minClicksForCvr,
  );
  const clickCvr = capConfidenceByCount(
    clickCvrRaw,
    adPurchases,
    BASELINE_GUARDS.minPurchasesForCvr,
  );
  const wilson = wilsonInterval(adPurchases, adClicks);
  const clickCvrInterval: RateInterval | undefined = wilson
    ? { low: wilson.low, high: wilson.high }
    : undefined;

  // Ad-attributed AOV = purchase value / VALUE-BEARING purchases. Dividing total
  // value by ALL purchases understates AOV when some "purchases" carry zero value
  // (the phantom rows above already filtered, but a real purchase can still post
  // a 0 value); use the count of purchases that actually carry value as the
  // denominator. Gate on a low floor (need ≥1), then cap confidence by count.
  const valueBearingPurchases = sumField(adRows, (r) =>
    r.purchaseValue > 0 ? r.purchases : 0,
  );
  const aov = haveAds
    ? capConfidenceByCount(
        pooledEstimate(adPurchaseValue, valueBearingPurchases, valueBearingPurchases, 1),
        valueBearingPurchases,
        BASELINE_GUARDS.minPurchasesForAov,
      )
    : estimateAov(shopify).estimate;

  // Whole-store Shopify AOV, kept for comparison/display only.
  const shopifyAovResult = estimateAov(shopify);
  const shopifyAov = shopifyAovResult.estimate;
  const storeOrders = sumField(shopify, (r) =>
    r.currency === "EUR" && r.grossRevenue >= 0 ? r.orders : 0,
  );

  const counts: ConversionCounts = { adPurchases, adClicks, storeOrders };

  const windowMeta: BaselineWindow = {
    start: window.start,
    end: window.end,
    days: daily.length,
  };

  // Latest ACTIVE spend day across ALL input rows (not just the window) — the
  // staleness signal. If the most recent spend is months old, the whole baseline
  // is stale regardless of the window chosen.
  const latestSpendDate = dailyRows
    .filter((d) => Number.isFinite(d.spend) && d.spend > 0)
    .map((d) => d.date)
    .sort()
    .pop();

  return {
    cpc,
    cpm,
    ctr,
    clickCvr,
    clickCvrInterval,
    aov,
    shopifyAov,
    counts,
    window: windowMeta,
    currency: "EUR",
    flags: {
      ...shopifyAovResult.flags,
      droppedPhantomConversions,
      latestSpendDate,
    },
  };
}

// ===========================================================================
// Default window selection
// ===========================================================================

/** Tunables for the default baseline window. */
export const DEFAULT_WINDOW = {
  /**
   * Calendar-day lookback from the most recent active spend-day. Spend is
   * intermittent and clustered (a campaign burst, then a long gap, then
   * another), so the most representative baseline is the latest cluster — not
   * an 8-month min→max span that dilutes CVR/CPC with stale activity. A
   * lookback of ~45 days isolates the most recent burst while still pooling
   * enough days to be stable. Tunable; the client can re-pool any window.
   */
  lookbackDays: 45,
} as const;

/** Inclusive whole-day difference between two ISO (YYYY-MM-DD) dates. */
function daysBetween(earlierIso: string, laterIso: string): number {
  const ms = Date.parse(`${laterIso}T00:00:00Z`) - Date.parse(`${earlierIso}T00:00:00Z`);
  return Math.round(ms / 86_400_000);
}

/**
 * Pick a sensible default pooling window: the active spend-days that fall
 * within `lookbackDays` calendar days of the MOST RECENT active spend-day, then
 * the inclusive span of those days. This isolates the latest campaign burst
 * rather than averaging across stale, intermittent spend. Falls back to an
 * all-encompassing window when no day has spend (so the caller still gets a
 * degenerate baseline rather than an empty one). Pure and unit-tested.
 */
export function defaultBaselineWindow(
  dailyRows: ReadonlyArray<DailyAdRow>,
  lookbackDays: number = DEFAULT_WINDOW.lookbackDays,
): DateWindow {
  const activeDays = dailyRows
    .filter((d) => Number.isFinite(d.spend) && d.spend > 0)
    .map((d) => d.date)
    .sort(); // ascending ISO

  if (activeDays.length === 0) {
    return { start: "1970-01-01", end: "2999-12-31" };
  }

  const latest = activeDays[activeDays.length - 1];
  // Keep active days no older than `lookbackDays` before the latest active day.
  const recent = activeDays.filter((d) => daysBetween(d, latest) <= lookbackDays);
  return { start: recent[0], end: latest };
}
