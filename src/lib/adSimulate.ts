/**
 * Paid-marketing simulator — orchestration: resolve a Scenario from a Baseline +
 * overrides, then run the funnel three times (low / expected / high) to produce
 * a sensitivity band.
 *
 * resolveScenario applies manual overrides onto a measured Baseline, validates
 * the one-CVR-grain invariant and the input sentinels, and throws a clear error
 * when a required input is missing (baseline below its volume guard AND no
 * override supplied). simulate then perturbs the two highest-variance inputs
 * (CVR and unit price) by the sensitivity bands and runs the same pure funnel
 * three times — so low/expected/high are three runs of ONE function, never
 * three formulas to keep in sync.
 *
 * The band is a DETERMINISTIC "what if X% off" sensitivity range, NOT a
 * statistical confidence interval. The data is too sparse for honest quantile
 * CIs; this is the honest alternative. (Upgrade path: empirical IQR band via
 * describe/quantile in stats.ts when click volume is high — not built here.)
 */

import {
  assertFractionInputs,
  assertNonNegativeInputs,
  validateScenarioGrain,
  DEFAULT_BANDS,
  DEFAULT_VAT_RATE,
  type Baseline,
  type PricingModel,
  type Projection,
  type RangedProjection,
  type Scenario,
  type SensitivityBands,
  type SimulationFlags,
} from "./adScenario";
import { runProjection } from "./adEconomics";

/**
 * Manual overrides layered onto a Baseline. Every field is optional; a set
 * field wins over the baseline estimate. Supply `bounceRate` + `sessionCvr`
 * together to switch the run to GA4 session grain (this clears the baseline's
 * click-grain CVR — you cannot mix grains). `budget` and `model` are required
 * because a baseline carries neither.
 */
export interface ScenarioOverrides {
  model: PricingModel;
  budget: number;
  /** Realized spend for CPA/ROAS; defaults to budget (full delivery). */
  spend?: number;
  /** Target CPA, EUR. Required for the "cps" (conversion-bid) model. */
  targetCpa?: number;
  cpc?: number;
  cpm?: number;
  ctr?: number;
  aov?: number;
  /** VAT rate, decimal (0.20 = 20%). Defaults to DEFAULT_VAT_RATE if unset. */
  vatRate?: number;
  /** Gross margin, decimal (0.65 = 65%). Defaults to 1.0 if unset. */
  grossMargin?: number;
  /** Lifetime repeat multiplier M = 1 + repeat rate. Defaults to 1.0 if unset. */
  ltvMultiplier?: number;
  /** Click-grain CVR override. Mutually exclusive with the session group. */
  clickCvr?: number;
  /** Session bounce rate. Requires sessionCvr; switches the run to session grain. */
  bounceRate?: number;
  /** Session-grain CVR. Requires bounceRate; switches the run to session grain. */
  sessionCvr?: number;
}

/** Pull an estimate's value, or undefined when below its volume guard. */
function baseValue(
  estimate: { value: number | undefined } | undefined,
): number | undefined {
  return estimate?.value;
}

/**
 * Resolve a runnable Scenario from a Baseline + overrides.
 *
 * Grain resolution: if the overrides specify the session group (bounceRate /
 * sessionCvr), the run is session-grain and the baseline's click CVR is NOT
 * carried (grains can't mix). Otherwise the run is click-grain, taking
 * clickCvr from the override or the baseline.
 *
 * Throws when: a required input for the chosen model is absent (e.g. CPM model
 * with no ctr from override or baseline), the grain invariant fails, or an
 * input fails the fraction / non-negative sentinels.
 */
export function resolveScenario(
  baseline: Baseline,
  overrides: ScenarioOverrides,
): Scenario {
  const budget = overrides.budget;
  const spend = overrides.spend ?? budget;

  // CPS (conversion-bid) buys conversions directly at a target CPA — there is no
  // traffic funnel, so it carries NO CVR grain (and no cpc/cpm/ctr). The
  // traffic models (cpc/cpm) carry exactly one CVR grain as before.
  const isCps = overrides.model === "cps";
  const wantsSessionGrain =
    !isCps &&
    (overrides.bounceRate !== undefined || overrides.sessionCvr !== undefined);

  const scenario: Scenario = {
    model: overrides.model,
    budget,
    spend,
    targetCpa: overrides.targetCpa,
    cpc: isCps ? undefined : overrides.cpc ?? baseValue(baseline.cpc),
    cpm: isCps ? undefined : overrides.cpm ?? baseValue(baseline.cpm),
    ctr: isCps ? undefined : overrides.ctr ?? baseValue(baseline.ctr),
    aov: overrides.aov ?? baseValue(baseline.aov) ?? NaN,
    // The baseline AOV is GROSS (incl. VAT); default the VAT split to the app
    // default so the resolved scenario runs net-correct even when the UI omits
    // it. (The pure economics layer defaults vatRate to 0 / no split.)
    vatRate: overrides.vatRate ?? DEFAULT_VAT_RATE,
    // Profit parameters have no baseline source (the ad/Shopify data carries no
    // margin or repeat rate); default to neutral so a caller that omits them
    // gets revenue-equivalent profit and front-end-only LTV.
    grossMargin: overrides.grossMargin ?? 1,
    ltvMultiplier: overrides.ltvMultiplier ?? 1,
    // Conversion grain — exactly one group populated for traffic models; NONE
    // for cps (it has no funnel).
    clickCvr: isCps
      ? undefined
      : wantsSessionGrain
        ? undefined
        : overrides.clickCvr ?? baseValue(baseline.clickCvr),
    bounceRate: wantsSessionGrain ? overrides.bounceRate : undefined,
    sessionCvr: wantsSessionGrain ? overrides.sessionCvr : undefined,
  };

  // Runnability first: report a MISSING required input (baseline below its
  // volume guard, no override) with an actionable "missing X" message, before
  // the value sentinels would fire a generic "not finite" on the NaN sentinel.
  assertRunnable(scenario);

  // Boundary guards — reject percent-scale / corrupt VALUES loudly.
  assertNonNegativeInputs(scenario);
  assertFractionInputs(scenario);

  // Grain invariant — only for traffic models. CPS legitimately has no grain.
  if (!isCps) {
    const grain = validateScenarioGrain(scenario);
    if (!grain.ok) {
      throw new Error(`[sim-input] invalid conversion grain: ${grain.reason}`);
    }
  }

  return scenario;
}

/** Throw if the scenario is missing an input its model needs to run. */
function assertRunnable(scenario: Scenario): void {
  const missing: string[] = [];
  if (!Number.isFinite(scenario.aov)) missing.push("aov");

  // CPS (conversion-bid): needs only a target CPA — no price, no CVR grain.
  if (scenario.model === "cps") {
    if (scenario.targetCpa === undefined) missing.push("targetCpa");
    if (missing.length > 0) throwMissing(scenario, missing);
    return;
  }

  if (scenario.model === "cpc") {
    if (scenario.cpc === undefined) missing.push("cpc");
  } else {
    if (scenario.cpm === undefined) missing.push("cpm");
    if (scenario.ctr === undefined) missing.push("ctr");
  }
  // No conversion grain at all (every CVR field undefined) is the same
  // "baseline below guard, no override" failure as a missing price — report it
  // here with the actionable message rather than letting the generic grain
  // check fire. A HALF-specified session grain is a distinct mistake and is
  // left for validateScenarioGrain to explain.
  if (
    scenario.clickCvr === undefined &&
    scenario.bounceRate === undefined &&
    scenario.sessionCvr === undefined
  ) {
    missing.push("clickCvr");
  }
  if (missing.length > 0) throwMissing(scenario, missing);
}

/** Shared actionable "missing required input" error for assertRunnable. */
function throwMissing(scenario: Scenario, missing: string[]): never {
  throw new Error(
    `[sim-input] cannot run ${scenario.model.toUpperCase()} model: missing ` +
      `${missing.join(", ")}. The baseline estimate was below its volume ` +
      `guard (confidence "none") and no override was supplied. Provide these ` +
      `as overrides.`,
  );
}

/** The price field a model is sensitive to: CPC for cpc, CPM for cpm. */
function priceField(model: PricingModel): "cpc" | "cpm" {
  return model === "cpm" ? "cpm" : "cpc";
}

/** The CVR field in play for a scenario's grain. */
function cvrField(scenario: Scenario): "clickCvr" | "sessionCvr" {
  return scenario.sessionCvr !== undefined ? "sessionCvr" : "clickCvr";
}

/**
 * Build a perturbed copy of a scenario for a low/high run. `cvrSign` and
 * `priceSign` are +1/-1; the resulting CVR is scaled by (1 + cvrSign*cvrBand)
 * and price by (1 + priceSign*priceBand). CVR is clamped to [0, 1] so a wide
 * band can't push it out of range; price is clamped to >= 0. Immutable: returns
 * a new scenario.
 *
 * CPS (conversion-bid) has no CVR axis and no cpc/cpm; its cost lever is
 * targetCpa, so the price band is applied to targetCpa instead (a higher CPA in
 * the low/worst case → fewer conversions per euro). The CVR term no-ops.
 */
function perturb(
  scenario: Scenario,
  bands: SensitivityBands,
  cvrSign: number,
  priceSign: number,
): Scenario {
  if (scenario.model === "cps") {
    const cpa = scenario.targetCpa;
    const nextCpa =
      cpa === undefined ? undefined : Math.max(0, cpa * (1 + priceSign * bands.priceBand));
    return { ...scenario, targetCpa: nextCpa };
  }

  const pf = priceField(scenario.model);
  const cf = cvrField(scenario);
  const price = scenario[pf];
  const cvr = scenario[cf];

  const nextPrice =
    price === undefined ? undefined : Math.max(0, price * (1 + priceSign * bands.priceBand));
  const nextCvr =
    cvr === undefined
      ? undefined
      : Math.min(1, Math.max(0, cvr * (1 + cvrSign * bands.cvrBand)));

  return { ...scenario, [pf]: nextPrice, [cf]: nextCvr };
}

/**
 * Run a forward simulation: low / expected / high projections plus flags.
 *
 * expected = the point-estimate scenario.
 * low  = CVR down, price up (fewer conversions, costlier) → worst case.
 * high = CVR up,   price down (more conversions, cheaper) → best case.
 *
 * `baseline` is optional and used only to derive the low-confidence /
 * mixed-currency flags; the math runs entirely off `scenario`.
 */
export function simulate(
  scenario: Scenario,
  options: { bands?: SensitivityBands; baseline?: Baseline } = {},
): RangedProjection {
  const bands = options.bands ?? DEFAULT_BANDS;

  const expected = runProjection(scenario);
  const low = runProjection(perturb(scenario, bands, -1, +1));
  const high = runProjection(perturb(scenario, bands, +1, -1));

  return {
    low,
    expected,
    high,
    bands,
    flags: buildFlags(scenario, options.baseline),
  };
}

/** Derive caveat flags from the scenario + (optional) source baseline. */
function buildFlags(
  scenario: Scenario,
  baseline: Baseline | undefined,
): SimulationFlags {
  const estimates = baseline
    ? [baseline.cpc, baseline.cpm, baseline.ctr, baseline.clickCvr, baseline.aov]
    : [];
  const lowConfidence = estimates.some(
    (e) => e.confidence === "low" || e.confidence === "none",
  );
  return {
    lowConfidence,
    mixedCurrency: baseline?.flags.mixedCurrency ?? false,
    // Click grain means no session split was supplied → bounce defaulted to 0.
    defaultedBounce: scenario.bounceRate === undefined,
  };
}

/** Convenience: estimate → resolve → simulate in one call is left to callers; */
/** keeping resolve and simulate separate lets a UI re-simulate on slider moves */
/** without re-resolving the whole scenario each time.                          */
export type { Projection, RangedProjection, Scenario };
