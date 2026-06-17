/**
 * Paid-marketing simulator — types, tunable constants, and input sentinels.
 *
 * This is the LEAF module of the paid lib (adScenario ← adEconomics, adBaseline,
 * adSimulate). It holds no math: only the data contracts every other module
 * shares, the tunable thresholds, and the boundary guards that reject
 * percent-scale / corrupt inputs BEFORE they reach the funnel (so a CTR stored
 * as 3.9 instead of 0.039 throws here rather than producing a 100x projection).
 *
 * Grain note (the central modeling decision — see adEconomics.ts for the funnel):
 * the funnel is impressions → clicks → sessions → conversions → revenue.
 * Conversion can be expressed at exactly ONE of two grains per run:
 *   - click-grain   `clickCvr`   = purchases / clicks   (the measured Bootle
 *     baseline; Daily Aggregates / Ad Snapshots have clicks + purchases but no
 *     sessions, so a pooled baseline can only ever produce this).
 *   - session-grain `bounceRate` + `sessionCvr`         (GA4 grain; manual
 *     override only, since GA4 is not in the data store today).
 * A run must set exactly one grain; the other is derived. resolveScenario in
 * adSimulate.ts enforces this and validateScenarioGrain below is the predicate.
 *
 * All money is EUR. All rates are DECIMAL fractions in [0, 1] (0.039 = 3.9%),
 * matching how the Airtable Marketing Intelligence base stores them.
 */

// ===========================================================================
// Core enums and estimate envelope
// ===========================================================================

/**
 * How spend converts to outcomes:
 *   - "cps" — conversion / target-CPA bid. The 2026 Meta default: you set budget
 *     + a target CPA (cost cap / ROAS goal) or accept an expected CPA (Highest
 *     Volume), and conversions = budget / CPA. CPM/CPC/CTR are auction OUTCOMES,
 *     not inputs, in this mode.
 *   - "cpc" — pay-per-click. clicks = budget / CPC (search-style). Diagnostic.
 *   - "cpm" — pay-per-mille. impressions = budget / CPM × 1000; clicks =
 *     impressions × CTR. Diagnostic.
 */
export type PricingModel = "cps" | "cpc" | "cpm";

/** Confidence in a pooled baseline estimate, set by its denominator volume. */
export type Confidence = "ok" | "low" | "none";

/**
 * A single baseline estimate with the volume it was pooled over and a
 * confidence flag. `value` is undefined when the denominator was below the
 * minimum-volume guard (confidence "none") — the caller must then supply a
 * manual override or the run is undefined for that input.
 */
export interface EstimateWithConfidence {
  value: number | undefined;
  /** The pooled denominator volume (e.g. total clicks for CPC, orders for AOV). */
  n: number;
  confidence: Confidence;
}

// ===========================================================================
// Baseline — output of adBaseline.estimateBaseline
// ===========================================================================

/** Window the baseline was pooled over (inclusive ISO dates). */
export interface BaselineWindow {
  start: string;
  end: string;
  /** Number of daily rows that fell inside the window. */
  days: number;
}

/** Non-fatal data-quality flags surfaced alongside a baseline. */
export interface BaselineFlags {
  /** Non-EUR Shopify rows were present and excluded from the AOV pool. */
  mixedCurrency: boolean;
  /** Count of Shopify rows dropped for a non-EUR currency. */
  droppedCurrencyRows: number;
  /** Count of Shopify rows dropped for a corrupt (negative) gross revenue. */
  droppedNegativeGrossRows: number;
  /** Count of Shopify rows dropped as 100%-off comp/test orders (net <= 0 or
   *  discounts >= gross) so free orders don't drag AOV down. */
  droppedCompRows: number;
  /** Count of ad conversions dropped for zero clicks AND zero spend (phantom
   *  view-through / sync-artifact purchases that inflate counts + crush AOV). */
  droppedPhantomConversions: number;
  /** Latest active ad-spend date in the data (ISO), for the staleness banner. */
  latestSpendDate: string | undefined;
}

/**
 * Measured baseline pooled from real ad + Shopify history. Every rate field is
 * click-grain or structural (no session grain — GA4 is not in the store). Feed
 * to resolveScenario as the starting point for a run; any field can be
 * overridden.
 */
/** 95% confidence range for a rate (e.g. a Wilson interval on CVR). */
export interface RateInterval {
  low: number;
  high: number;
}

/**
 * Counts behind the conversion figures, surfaced so the source disagreement is
 * visible rather than hidden inside one rate. `adPurchases` is the ad-attributed
 * conversion count (drives CVR); `storeOrders` is the whole-store Shopify order
 * count over the same window. They legitimately differ (pixel attribution vs
 * total store sales) — showing both is honest.
 */
export interface ConversionCounts {
  adPurchases: number;
  adClicks: number;
  storeOrders: number;
}

/**
 * Measured baseline pooled from real ad + Shopify history. Rates are click-grain
 * or structural (no session grain — GA4 is not in the store).
 *
 * The conversion funnel (clickCvr + aov) is AD-ATTRIBUTED and SAME-SOURCE: both
 * come from Ad Snapshots (purchases/clicks and purchaseValue/purchases), so the
 * funnel is internally consistent. `shopifyAov` is the whole-store basket kept
 * only for comparison/display — it over-credits an ad conversion with organic +
 * bundle value and is NOT the default funnel input.
 */
export interface Baseline {
  cpc: EstimateWithConfidence;
  cpm: EstimateWithConfidence;
  /** Click-through rate, decimal fraction. */
  ctr: EstimateWithConfidence;
  /** Click-grain CVR (ad purchases / clicks), decimal fraction. Ad-attributed. */
  clickCvr: EstimateWithConfidence;
  /** 95% Wilson interval on clickCvr — wide on small conversion samples. */
  clickCvrInterval: RateInterval | undefined;
  /** Ad-attributed AOV, EUR = ad purchase value / ad purchases. Funnel default. */
  aov: EstimateWithConfidence;
  /** Whole-store AOV, EUR = Shopify gross / orders. For comparison only. */
  shopifyAov: EstimateWithConfidence;
  /** The conversion counts behind CVR/AOV, for surfacing the source gap. */
  counts: ConversionCounts;
  window: BaselineWindow;
  /** Target currency the baseline is denominated in (always "EUR" in v1). */
  currency: "EUR";
  flags: BaselineFlags;
}

// ===========================================================================
// Scenario — fully-resolved run inputs (post-override, pre-funnel)
// ===========================================================================

/**
 * The resolved inputs for ONE funnel run. Produced by
 * adSimulate.resolveScenario (baseline + overrides) and consumed by
 * adEconomics. Exactly one CVR grain must be populated:
 *   - click-grain:   clickCvr set; bounceRate/sessionCvr undefined.
 *   - session-grain: bounceRate + sessionCvr set; clickCvr undefined.
 * `spend` is the realized spend for derived metrics; the simulator assumes full
 * budget delivery so spend === budget, but it is explicit so a future
 * partial-delivery model can override it.
 */
export interface Scenario {
  model: PricingModel;
  /** Planned budget, EUR. */
  budget: number;
  /** Realized spend for CPA/ROAS, EUR. Defaults to budget (full delivery). */
  spend: number;
  /**
   * Target cost per acquisition, EUR. Required for the "cps" model:
   * conversions = budget / targetCpa. This is the cost cap (Cost Cap / ROAS
   * goal) or the expected CPA (Highest Volume) — the actual control surface on
   * Meta in 2026, where CPM/CPC are outcomes.
   */
  targetCpa?: number;
  /** Cost per click, EUR. Required for the "cpc" model. */
  cpc?: number;
  /** Cost per mille, EUR. Required for the "cpm" model. */
  cpm?: number;
  /** Click-through rate, decimal (LINK / outbound CTR, not All CTR). Required for "cpm". */
  ctr?: number;
  /**
   * Average order value, EUR, GROSS (VAT-inclusive) — it is what the customer
   * paid (Meta purchaseValue / Shopify gross revenue), and Bootle storefront
   * prices display incl. VAT. Top-line revenue and ROAS use this gross figure
   * (ad-platform convention); profit/break-even use the NET figure
   * aov / (1 + vatRate). Required (revenue = conversions * aov).
   */
  aov: number;
  /**
   * VAT as a decimal of the GROSS AOV (0.20 = 20% UK). VAT is collected for the
   * state and remitted, never income, so net AOV = aov / (1 + vatRate) is the
   * basis for gross profit and break-even. Revenue and ROAS stay gross. Bootle
   * has no single rate (DE 19, FR 20, IT 22, IE 23, UK 20; variance absorbed at
   * one price band) so this is an adjustable assumption. Defaults to 0 in the
   * pure layer (no VAT split); resolveScenario / the UI supply DEFAULT_VAT_RATE.
   */
  vatRate?: number;
  /**
   * Gross margin as a decimal (0.65 = 65%). Gross profit per conversion is
   * netAov * gm (margin is measured on NET, ex-VAT, revenue — the standard COGS
   * convention); break-even and profit are computed against gross profit, NOT
   * revenue. Required for profit/break-even; defaults to 1 (treat net AOV as
   * pure margin) only if a caller explicitly opts out.
   */
  grossMargin: number;
  /**
   * Lifetime repeat multiplier M = 1 + repeatPurchaseRate (1.0 = no repeat,
   * front-end only). Scales gross profit to capture backend accessory sales on
   * a modular product. M >= 1.
   */
  ltvMultiplier: number;

  // --- conversion grain: exactly one of the two groups below ---
  /** Click-grain CVR (purchases / clicks), decimal. */
  clickCvr?: number;
  /** Session bounce rate, decimal. Session-grain group. */
  bounceRate?: number;
  /** Session-grain CVR (purchases / sessions), decimal. Session-grain group. */
  sessionCvr?: number;
}

// ===========================================================================
// Projection — output of one funnel run
// ===========================================================================

/**
 * Result of one funnel run. Every field is a number or `undefined` — undefined
 * means "not computable" (e.g. CPA when conversions are 0) and renders as "—".
 * Counts (impressions/clicks/sessions/conversions) are kept as fractional
 * floats; rounding is a display concern only.
 */
export interface Projection {
  impressions: number | undefined;
  clicks: number | undefined;
  sessions: number | undefined;
  conversions: number | undefined;
  /** Top-line revenue, GROSS (VAT-inclusive): conversions * aov. Ties to the ad platform. */
  revenue: number | undefined;
  /**
   * Net revenue, EX-VAT: conversions * (aov / (1 + vatRate)). The honest
   * top-line you keep, and the basis for all profit/break-even below. Equals
   * `revenue` when vatRate is 0/undefined.
   */
  netRevenue: number | undefined;
  /** Gross profit on the front end, conversions * netAov * grossMargin (no M). */
  grossProfit: number | undefined;
  /** Cost per acquisition, EUR. Undefined when conversions are 0. */
  cpa: number | undefined;
  /** Return on ad spend, revenue / spend. Undefined when spend is 0. */
  roas: number | undefined;
  /**
   * Front-end net profit per sale, EUR: aov*grossMargin − cpa. Negative when
   * CPA exceeds gross profit per unit (you lose money on the first sale).
   */
  profitPerSale: number | undefined;
  /**
   * Lifetime net profit per sale including the repeat multiplier:
   * aov*grossMargin*ltvMultiplier − cpa.
   */
  profitPerSaleLtv: number | undefined;
  /** Total front-end net profit, EUR: grossProfit − spend. */
  totalProfit: number | undefined;
  /**
   * Click-grain CVR at which front-end profit = 0, given price and gross
   * profit per unit: effectiveCpc / (aov*grossMargin).
   */
  breakEvenCvr: number | undefined;
  /** Same break-even CVR but crediting lifetime value (divides by *M). */
  breakEvenCvrLtv: number | undefined;
  /** CPA at which front-end profit = 0 — equals gross profit per unit (aov*gm). */
  breakEvenCpa: number | undefined;
  /**
   * Minimum daily budget to clear Meta's learning phase at this CPA:
   * (LEARNING_PHASE.conversions / LEARNING_PHASE.windowDays) * cpa. Undefined
   * when CPA is. See LEARNING_PHASE for the current threshold (50 events / 7d).
   */
  minDailyBudget: number | undefined;
}

/** Flags surfaced on a simulation so the caller can caveat the numbers. */
export interface SimulationFlags {
  /** Any input used a baseline estimate with confidence "low" or "none". */
  lowConfidence: boolean;
  /** Carried from the baseline: a non-EUR currency was excluded. */
  mixedCurrency: boolean;
  /** bounceRate was defaulted to 0 (no GA4 session split supplied). */
  defaultedBounce: boolean;
}

/** Forward simulation: a low / expected / high band of projections. */
export interface RangedProjection {
  low: Projection;
  expected: Projection;
  high: Projection;
  bands: SensitivityBands;
  flags: SimulationFlags;
}

// ===========================================================================
// Tunable constants (pattern: scoreConfig.ts — exported, test-pinned)
// ===========================================================================

/**
 * Minimum pooled denominator volume for a baseline estimate to be trusted.
 * Below the floor the estimate is `undefined` / confidence "none". CVR needs
 * far more volume than price/CTR because at ~1 purchase/day a small click pool
 * gives a CVR dominated by 0/1 luck. `lowMultiple` marks the "ok"→"low"
 * boundary: an estimate within lowMultiple× of its floor is returned but
 * flagged thin.
 */
export const BASELINE_GUARDS = {
  /** Min total clicks for CPC / CTR / CPM to be trustworthy. */
  minClicks: 30,
  /** Min total impressions for CTR / CPM. */
  minImpressions: 1000,
  /** Min total clicks for a click-grain CVR (denominator sufficiency). */
  minClicksForCvr: 200,
  /**
   * Min ad PURCHASES (the rare numerator) for CVR confidence. A CVR from a
   * handful of conversions is statistically fragile even on plenty of clicks —
   * 5/2624 reads "ok" on clicks alone but the rate could be off by 2-3x. Below
   * this, CVR confidence is capped to "low" and the count is surfaced.
   */
  minPurchasesForCvr: 10,
  /** Min total orders for a (Shopify) AOV. */
  minOrders: 10,
  /** Min ad purchases for an ad-attributed AOV (same small-numerator concern). */
  minPurchasesForAov: 10,
  /** Within this multiple of a floor → confidence "low" rather than "ok". */
  lowMultiple: 2,
} as const;

/** Relative sensitivity bands for the low/high simulation runs. */
export interface SensitivityBands {
  /** Fractional band applied to CVR (the noisiest input). 0.35 = ±35%. */
  cvrBand: number;
  /** Fractional band applied to unit price (CPC/CPM). 0.20 = ±20%. */
  priceBand: number;
}

/**
 * Default sensitivity bands. CVR gets the wider band because it is the
 * highest-variance term in Bootle's sparse data. These describe a deterministic
 * "what if X% off" sensitivity range, NOT a statistical confidence interval —
 * the data is too sparse to support real quantile CIs.
 */
export const DEFAULT_BANDS: SensitivityBands = {
  cvrBand: 0.35,
  priceBand: 0.2,
};

/**
 * Meta learning-phase exit threshold: an ad set needs ~50 optimization events
 * (the chosen conversion event — purchases when optimizing for Purchase, pixel +
 * CAPI + modeled) per rolling 7-day window to stabilize and leave "Learning
 * Limited". This is per AD SET, not per ad, and is unchanged in 2025-2026,
 * including under Advantage+. Used to derive a minimum daily budget =
 * (conversions/windowDays) * CPA — the concrete "you need €X/day per ad set to
 * keep the algorithm out of Learning Limited" figure.
 *
 * (Was 25 before 2026-06; corrected to 50 after a sourced audit — the 25 value
 * understated the required budget by ~2×.)
 */
export const LEARNING_PHASE = {
  conversions: 50,
  windowDays: 7,
} as const;

/**
 * Default VAT rate applied to the gross AOV to derive net (ex-VAT) revenue for
 * profit/break-even. 0.20 = UK 20%. Bootle has no single rate across markets
 * (DE 19, FR 20, IT 22, IE 23; variance absorbed at one price band), so this is
 * a conservative, adjustable default — UK 20% sits mid-band and makes break-even
 * read slightly harder (the safe direction). The pure economics layer defaults
 * vatRate to 0 (no split); this constant is the app/UI default supplied by
 * resolveScenario and PaidPanel.
 */
export const DEFAULT_VAT_RATE = 0.2;

/**
 * Provisional storefront conversion rate used as the default CVR until live GA4
 * purchase attribution is wired in (WEBDEV-103). Sourced from Shopify Analytics'
 * own funnel — sessions → completed checkout — over the trailing 90 days:
 *   5,826 human sessions → 12 completed checkouts = 0.2% (to 2026-06-17).
 * This is ALL-TRAFFIC storefront CVR (organic + direct + paid blended), NOT
 * ad-attributed; paid-only CVR may differ once ads run with live attribution.
 * It replaces the stale Jan-2026 ad-attributed CVR (a 5-conversion sample whose
 * spend ended 2026-01-22). Editable in the UI; update this constant or wire a
 * live Shopify-sessions feed to refresh.
 *
 * The funnel also shows the binding leak is sessions → add-to-cart (2.3%),
 * consistent with the PDP→ATC drop tracked in WEBDEV-149.
 */
export const PROVISIONAL_SESSION_CVR = 0.002;
/** Date the PROVISIONAL_SESSION_CVR was read from Shopify Analytics. */
export const PROVISIONAL_CVR_AS_OF = "2026-06-17";

// ===========================================================================
// Input sentinels — boundary guards (pattern ported from rateSentinel.ts)
// ===========================================================================

/** Fields that must be DECIMAL fractions in [0, 1]. */
const FRACTION_FIELDS: ReadonlyArray<keyof Scenario> = [
  "ctr",
  "bounceRate",
  "sessionCvr",
  "clickCvr",
  "grossMargin",
  "vatRate",
];

/** Fields that must be finite and >= 0 (counts / prices, not fractions). */
const NON_NEGATIVE_FIELDS: ReadonlyArray<keyof Scenario> = [
  "budget",
  "spend",
  "targetCpa",
  "cpc",
  "cpm",
  "aov",
];

/**
 * Assert every populated fraction-typed input is in [0, 1]. A value above 1 is
 * the percent-scale signature (CTR stored 3.9 instead of 0.039), which would
 * make the projection 100x too large; a negative rate is corrupt either way.
 * Undefined fields are skipped (they're simply not set for this grain/model).
 * Throws a `[sim-input]` error — caught at the simulator boundary, never
 * silently producing a wrong number.
 */
export function assertFractionInputs(scenario: Scenario): void {
  for (const field of FRACTION_FIELDS) {
    const v = scenario[field];
    if (v === undefined) continue;
    if (typeof v !== "number" || !Number.isFinite(v) || v < 0 || v > 1) {
      throw new Error(
        `[sim-input] ${String(field)} = ${JSON.stringify(v)} is not a decimal ` +
          `fraction in [0, 1]. Rates must be fractions (0.039 = 3.9%); a value ` +
          `above 1 means a percent-scale value leaked in (rendered 100x too ` +
          `large), and a negative rate is corrupt.`,
      );
    }
  }
}

/** Assert every populated count/price input is finite and >= 0. */
export function assertNonNegativeInputs(scenario: Scenario): void {
  for (const field of NON_NEGATIVE_FIELDS) {
    const v = scenario[field];
    if (v === undefined) continue;
    if (typeof v !== "number" || !Number.isFinite(v) || v < 0) {
      throw new Error(
        `[sim-input] ${String(field)} = ${JSON.stringify(v)} must be a finite ` +
          `number >= 0 (EUR amount or count).`,
      );
    }
  }
  // ltvMultiplier is M = 1 + repeatRate, so it must be finite and >= 1.
  const m = scenario.ltvMultiplier;
  if (typeof m !== "number" || !Number.isFinite(m) || m < 1) {
    throw new Error(
      `[sim-input] ltvMultiplier = ${JSON.stringify(m)} must be a finite ` +
        `number >= 1 (M = 1 + repeat-purchase rate).`,
    );
  }
}

// ===========================================================================
// Conversion-grain invariant
// ===========================================================================

export type GrainCheck =
  | { ok: true; grain: "click" | "session" }
  | { ok: false; reason: string };

/**
 * Validate that exactly one CVR grain is populated. Click-grain = `clickCvr`
 * set with no session fields; session-grain = both `bounceRate` and
 * `sessionCvr` set with no `clickCvr`. Anything else (both grains, neither,
 * a half-specified session grain) is rejected so the funnel never
 * double-counts bounce or runs without a conversion rate.
 */
export function validateScenarioGrain(scenario: Scenario): GrainCheck {
  const hasClick = scenario.clickCvr !== undefined;
  const hasBounce = scenario.bounceRate !== undefined;
  const hasSessionCvr = scenario.sessionCvr !== undefined;
  const hasSession = hasBounce || hasSessionCvr;

  if (hasClick && hasSession) {
    return {
      ok: false,
      reason:
        "Both conversion grains are set: clickCvr cannot coexist with " +
        "bounceRate/sessionCvr. Pick one grain per run.",
    };
  }
  if (hasClick) return { ok: true, grain: "click" };
  if (hasBounce && hasSessionCvr) return { ok: true, grain: "session" };
  if (hasSession) {
    return {
      ok: false,
      reason:
        "Session grain is half-specified: both bounceRate and sessionCvr are " +
        "required together.",
    };
  }
  return {
    ok: false,
    reason:
      "No conversion grain set: provide either clickCvr, or bounceRate + " +
      "sessionCvr.",
  };
}
