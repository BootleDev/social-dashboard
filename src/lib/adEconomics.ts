/**
 * Paid-marketing simulator — funnel + derived economics. Fully pure, no I/O.
 *
 * Takes a fully-resolved Scenario (see adScenario.ts; overrides already applied
 * by adSimulate.resolveScenario) and runs one pass of the funnel:
 *
 *   impressions → clicks → sessions → conversions → revenue
 *
 * VAT / gross vs net (central correctness decision):
 *   The AOV is GROSS (VAT-inclusive — what the customer paid). VAT is collected
 *   for the state and remitted, never income, so:
 *     - revenue + ROAS use the GROSS aov (ad-platform convention; ties to Meta /
 *       Google / Shopify so the tool reconciles against Ads Manager).
 *     - netRevenue, grossProfit, profit/sale, totalProfit, break-even CVR/CPA all
 *       use NET aov = aov / (1 + vatRate). grossMargin is a margin on NET revenue.
 *   vatRate defaults to 0 here (no split) so callers that omit it get the old
 *   gross behaviour unchanged; the app supplies the real rate (see DEFAULT_VAT_RATE).
 *
 * THE GRAIN (central correctness decision):
 *   - clickToSessionRate = 1 - bounceRate   (clicks that become engaged sessions)
 *   - conversions        = sessions * sessionCvr
 *   - identity: clickCvr = (1 - bounceRate) * sessionCvr
 * A run is driven by exactly ONE grain (validated upstream):
 *   - click-grain   → clickCvr set; we model it as bounceRate=0, sessionCvr=clickCvr,
 *     so sessions === clicks and conversions === clicks * clickCvr (the measured
 *     Ad-Snapshots grain, unchanged).
 *   - session-grain → bounceRate + sessionCvr set; sessions < clicks and CVR is
 *     applied at session grain. Bounce is counted EXACTLY ONCE.
 *
 * Numeric contract: every ratio goes through `ratio()`, which returns
 * `undefined` (never Infinity / NaN / 0) for an undefined quotient. undefined
 * propagates through the chain. NO rounding mid-chain — conversions stay
 * fractional (0.43 conversions is a legitimate projection); rounding is a
 * display concern handled by the UI layer.
 */

import { LEARNING_PHASE, type Scenario, type Projection } from "./adScenario";

/**
 * The one division primitive. Returns undefined unless both operands are finite
 * and the denominator is strictly positive. This is the single guard against
 * the entire divide-by-zero / divide-by-noise bug class in this domain (mirrors
 * `safeRate` in derivedMetrics.ts).
 */
export function ratio(num: number, den: number): number | undefined {
  if (!Number.isFinite(num) || !Number.isFinite(den)) return undefined;
  if (den <= 0) return undefined;
  return num / den;
}

/** Multiply two possibly-undefined operands; undefined if either is undefined. */
function mul(
  a: number | undefined,
  b: number | undefined,
): number | undefined {
  if (a === undefined || b === undefined) return undefined;
  if (!Number.isFinite(a) || !Number.isFinite(b)) return undefined;
  return a * b;
}

/**
 * Effective click→session survival factor. Click grain (no bounceRate) means
 * every click is a session, so the factor is 1. Session grain applies
 * (1 - bounceRate). bounceRate is validated to [0, 1] upstream, so this is in
 * [0, 1].
 */
function clickToSessionRate(scenario: Scenario): number {
  return scenario.bounceRate === undefined ? 1 : 1 - scenario.bounceRate;
}

/**
 * Session-grain CVR for the run. Click grain stores its CVR in `clickCvr` and
 * models bounce as 0, so sessionCvr === clickCvr. Session grain uses
 * `sessionCvr` directly. Returns undefined if neither is set (shouldn't happen
 * post-validation, but the funnel stays honest).
 */
function effectiveSessionCvr(scenario: Scenario): number | undefined {
  if (scenario.clickCvr !== undefined) return scenario.clickCvr;
  return scenario.sessionCvr;
}

/**
 * Net (ex-VAT) AOV = gross aov / (1 + vatRate). VAT is remitted, not income, so
 * this is the revenue actually kept and the basis for all profit/break-even
 * math. vatRate is validated to [0, 1] upstream; when undefined or 0 this
 * returns the gross aov unchanged (back-compat for callers that omit VAT).
 */
export function netAov(scenario: Scenario): number {
  return scenario.aov / (1 + (scenario.vatRate ?? 0));
}

/**
 * Traffic tail: clicks → sessions → conversions, then hand off to
 * runFromConversions. The CPC and CPM models converge here once `clicks` is
 * known, so the clicks→conversions math exists in exactly one place.
 *
 * `impressions` is threaded through only so it lands in the Projection (CPM
 * computes it; CPC leaves it undefined — there's no impression count when you
 * buy clicks directly).
 */
function runDownstream(
  scenario: Scenario,
  clicks: number | undefined,
  impressions: number | undefined,
): Projection {
  const sessions = mul(clicks, clickToSessionRate(scenario));
  const conversions = mul(sessions, effectiveSessionCvr(scenario));
  return runFromConversions(scenario, conversions, { clicks, impressions, sessions });
}

/**
 * Conversions-onward tail: conversions → revenue → profit → derived. This is
 * the single source of the money math shared by ALL pricing models — the
 * traffic models (CPC/CPM) reach it via runDownstream once they've turned spend
 * into conversions through the funnel; the conversion-bid model (CPS) reaches it
 * directly because it buys conversions at a target CPA with no traffic stage.
 *
 * `traffic` carries the upstream counts (clicks/impressions/sessions) purely so
 * they land in the Projection; they are undefined for CPS (you buy results, not
 * clicks) and do not affect any money figure.
 */
function runFromConversions(
  scenario: Scenario,
  conversions: number | undefined,
  traffic: {
    clicks?: number | undefined;
    impressions?: number | undefined;
    sessions?: number | undefined;
  } = {},
): Projection {
  const { clicks, impressions, sessions } = traffic;
  // Revenue is GROSS (VAT-inclusive) — ties to the ad platform / Shopify.
  const revenue = mul(conversions, scenario.aov);
  // Net revenue (ex-VAT) is the honest top-line you keep; basis for profit.
  const netRevenue = mul(conversions, netAov(scenario));

  // Gross profit per conversion = NET aov * grossMargin (margin is on ex-VAT
  // revenue); total = conversions * that.
  const grossProfitPerUnit = netAov(scenario) * scenario.grossMargin;
  const grossProfit = mul(conversions, grossProfitPerUnit);

  // CPA = spend / conversions. Undefined (not Infinity) when conversions are 0.
  const cpa =
    conversions === undefined ? undefined : ratio(scenario.spend, conversions);
  // ROAS = revenue / spend. Undefined when spend is 0.
  const roas =
    revenue === undefined ? undefined : ratio(revenue, scenario.spend);

  // Profit per sale (front-end) = gross profit per unit − CPA. Can be negative.
  const profitPerSale =
    cpa === undefined ? undefined : grossProfitPerUnit - cpa;
  // Lifetime profit per sale credits the repeat multiplier on the gross profit.
  const profitPerSaleLtv =
    cpa === undefined
      ? undefined
      : grossProfitPerUnit * scenario.ltvMultiplier - cpa;
  // Total front-end net profit = gross profit − spend.
  const totalProfit =
    grossProfit === undefined ? undefined : grossProfit - scenario.spend;

  // Minimum daily budget to clear the learning phase at this CPA.
  const minDailyBudget =
    cpa === undefined
      ? undefined
      : (LEARNING_PHASE.conversions / LEARNING_PHASE.windowDays) * cpa;

  return {
    impressions,
    clicks,
    sessions,
    conversions,
    revenue,
    netRevenue,
    grossProfit,
    cpa,
    roas,
    profitPerSale,
    profitPerSaleLtv,
    totalProfit,
    breakEvenCvr: breakEvenClickCvr(scenario),
    breakEvenCvrLtv: breakEvenClickCvr(scenario, true),
    breakEvenCpa: breakEvenCpa(scenario),
    minDailyBudget,
  };
}

/**
 * CPC model: clicks = budget / cpc, then the shared tail. There is no
 * impression count (you buy clicks), so impressions stays undefined.
 */
export function runCpc(scenario: Scenario): Projection {
  const clicks =
    scenario.cpc === undefined ? undefined : ratio(scenario.budget, scenario.cpc);
  return runDownstream(scenario, clicks, undefined);
}

/**
 * CPM model: impressions = budget / cpm * 1000, clicks = impressions * ctr,
 * then the shared tail.
 */
export function runCpm(scenario: Scenario): Projection {
  const perMille =
    scenario.cpm === undefined ? undefined : ratio(scenario.budget, scenario.cpm);
  const impressions = mul(perMille, 1000);
  const clicks = mul(impressions, scenario.ctr);
  return runDownstream(scenario, clicks, impressions);
}

/**
 * CPS model (conversion / target-CPA bid — the 2026 Meta default): conversions
 * are bought directly at the target CPA, so conversions = budget / targetCpa.
 * There is no click or impression count in this mode (you buy results, not
 * traffic), so both stay undefined and the funnel tail runs from conversions.
 *
 * The shared tail derives revenue/profit/break-even from conversions exactly as
 * the other models do. CPA in the projection equals targetCpa by construction
 * (spend / conversions = spend / (budget/targetCpa) = targetCpa when spend ===
 * budget) — a useful internal consistency check.
 */
export function runCps(scenario: Scenario): Projection {
  const conversions =
    scenario.targetCpa === undefined
      ? undefined
      : ratio(scenario.budget, scenario.targetCpa);
  // Straight to the shared money tail — no traffic stage (clicks/impressions
  // stay undefined; you buy results, not clicks).
  return runFromConversions(scenario, conversions);
}

/** Dispatch to the model's funnel run. */
export function runProjection(scenario: Scenario): Projection {
  if (scenario.model === "cps") return runCps(scenario);
  return scenario.model === "cpm" ? runCpm(scenario) : runCpc(scenario);
}

// ===========================================================================
// Break-even helpers
// ===========================================================================

/**
 * Effective cost per click for the run's pricing model:
 *   - CPC model: the cpc input directly.
 *   - CPM model: cpm / (ctr * 1000) — the implied price of a click given how
 *     many clicks a mille of impressions yields.
 * Undefined if the inputs needed aren't present / are zero.
 */
export function effectiveCpc(scenario: Scenario): number | undefined {
  if (scenario.model === "cpc") return scenario.cpc;
  if (scenario.cpm === undefined || scenario.ctr === undefined) return undefined;
  const clicksPerMille = mul(scenario.ctr, 1000); // clicks per 1000 impressions
  if (clicksPerMille === undefined) return undefined;
  return ratio(scenario.cpm, clicksPerMille);
}

/**
 * Click-grain CVR at which front-end PROFIT = 0 (not ROAS = 1 — profit accounts
 * for gross margin). From spend/click = effectiveCpc and gross-profit/click =
 * clickCvr * netAov * grossMargin, profit = 0 ⇒
 *   clickCvr = effectiveCpc / (netAov * grossMargin).
 * Uses NET aov (profit is on ex-VAT revenue), so a non-zero vatRate RAISES the
 * break-even bar. With `includeLtv`, the denominator is also multiplied by the
 * LTV multiplier M (a repeat purchase lowers the bar). One formula for both
 * pricing models (CPM reduces to its effective CPC first).
 */
export function breakEvenClickCvr(
  scenario: Scenario,
  includeLtv = false,
): number | undefined {
  const ecpc = effectiveCpc(scenario);
  if (ecpc === undefined) return undefined;
  const m = includeLtv ? scenario.ltvMultiplier : 1;
  return ratio(ecpc, netAov(scenario) * scenario.grossMargin * m);
}

/**
 * CPA at which front-end profit = 0 — equals gross profit per unit
 * (netAov * grossMargin). Above this CPA you lose money on the first sale.
 * Uses NET aov, so a non-zero vatRate LOWERS the allowable break-even CPA.
 */
export function breakEvenCpa(scenario: Scenario): number | undefined {
  const gp = netAov(scenario) * scenario.grossMargin;
  return Number.isFinite(gp) && gp >= 0 ? gp : undefined;
}

// ===========================================================================
// CPS implied diagnostics — back out the CPM/CPC/CTR a target-CPA bid implies
// ===========================================================================

/**
 * The traffic prices a conversion-bid (CPS) run IMPLIES, given an assumed
 * click-CVR. In 2026 you don't set CPM/CPC — they're auction outcomes — but it
 * is useful to see what they'd have to be for a given target CPA to pencil out:
 *   conversions = budget / targetCpa
 *   clicks      = conversions / clickCvr      (need CVR to relate the two)
 *   impliedCpc  = budget / clicks = targetCpa * clickCvr
 *   impliedCpm  = impliedCpc * ctr * 1000     (needs an assumed CTR too)
 * All undefined when the inputs needed aren't present / are zero. `clickCvr`
 * and `ctr` are the ASSUMED rates (typically the baseline); they are how you
 * relate a results price back to a traffic price. Pure; for display only.
 */
export function impliedFromCps(
  scenario: Scenario,
  assumed: { clickCvr?: number; ctr?: number },
): { impliedCpc: number | undefined; impliedCpm: number | undefined } {
  const targetCpa = scenario.targetCpa;
  const clickCvr = assumed.clickCvr;
  if (targetCpa === undefined || clickCvr === undefined) {
    return { impliedCpc: undefined, impliedCpm: undefined };
  }
  // impliedCpc = targetCpa * clickCvr (cost per click = cost per sale × sales/click).
  const impliedCpc = targetCpa * clickCvr;
  // impliedCpm = impliedCpc × ctr × 1000 (cost per 1000 impressions at that CTR).
  const impliedCpm =
    assumed.ctr === undefined ? undefined : impliedCpc * assumed.ctr * 1000;
  return {
    impliedCpc: Number.isFinite(impliedCpc) ? impliedCpc : undefined,
    impliedCpm: impliedCpm !== undefined && Number.isFinite(impliedCpm) ? impliedCpm : undefined,
  };
}
