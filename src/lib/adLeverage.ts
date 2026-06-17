/**
 * Paid-marketing simulator — leverage analysis. Turns a projection into a
 * DECISION: are we above or below break-even, by how much, which single input is
 * the binding constraint, and how far each lever would have to move ON ITS OWN
 * to reach break-even. Pure, no I/O.
 *
 * WHY THIS EXISTS: the funnel answers "given these inputs, what's the
 * projection?". The operator's real question is the inverse — "what should I fix
 * first?". The highest-leverage fix is the lever that needs the SMALLEST,
 * most-achievable change to cross break-even; a lever that's already efficient
 * (or that would need an impossible change) has no leverage no matter how much
 * you tune it.
 *
 * THE MATH (closed form, no search):
 *   At break-even, front-end profit = 0, i.e. grossProfit = spend, where
 *   grossProfit = conversions × netAov × grossMargin.
 *   - CVR, AOV, grossMargin are LINEAR in grossProfit. To bring grossProfit up
 *     to spend, multiply the lever by  spend / grossProfit. (grossMargin is
 *     additionally capped at 1.0 — you can't have >100% margin — so its required
 *     factor may be unreachable.)
 *   - The COST lever (targetCpa for cps; effective CPC for cpc/cpm) is INVERSE:
 *     conversions ∝ 1/cost, so grossProfit ∝ 1/cost. To raise grossProfit to
 *     spend, the cost must shrink to  grossProfit / spend  of its current value.
 *   These are verified in the tests by applying each factor back through
 *   runProjection and asserting totalProfit ≈ 0.
 */

import { runProjection, effectiveCpc } from "./adEconomics";
import type { Projection, Scenario } from "./adScenario";

/** Display unit for a lever's real-world values. */
export type LeverUnit = "pct" | "eur";

/** A lever the operator can move, with its break-even threshold + profit sensitivity. */
export interface Lever {
  /** Stable key for the lever. */
  key: "cvr" | "aov" | "grossMargin" | "cost";
  /** Human label for the UI. */
  label: string;
  /** Display unit for currentValue / breakEvenValue. */
  unit: LeverUnit;
  /** The lever's current value in real units (decimal fraction for pct, EUR for eur). */
  currentValue: number | undefined;
  /**
   * The value at which front-end profit = 0, holding all else fixed — the real
   * floor (for lift levers) or ceiling (for the cost lever). undefined when not
   * computable.
   */
  breakEvenValue: number | undefined;
  /**
   * Marginal profit impact of a one-natural-step move in this lever, EUR. A
   * "step" is +1 percentage point for pct levers, +€1 for the cost lever, +€1 of
   * AOV. Signed: positive = moving the lever up adds profit (CVR/AOV/margin),
   * negative = moving it up cuts profit (cost). undefined when not computable.
   */
  profitPerStep: number | undefined;
  /** The natural step size as a label, e.g. "+1pp", "+€1". */
  stepLabel: string;
  /**
   * Multiplicative factor to reach break-even ON ITS OWN (kept for ranking and
   * back-compat). >1 = must increase (lift levers); <1 = must shrink (cost).
   */
  factor: number | undefined;
  /** Whether `factor` is realistically achievable on this lever alone. */
  reachable: boolean;
  /** True for the thinnest-margin lever — the one most at risk / to watch. */
  binding: boolean;
  /** One-line plain-language note: real-unit threshold + sensitivity. */
  note: string;
}

/** The decision verdict for a scenario. */
export interface Verdict {
  /**
   * "scale" — already profitable (totalProfit ≥ 0); "marginal" — within a small
   * band of break-even; "hold" — below break-even, do not scale.
   */
  status: "scale" | "marginal" | "hold";
  /**
   * How far from break-even, as a multiple. For a below-break-even run this is
   * spend / grossProfit (e.g. 27 = "27× below the line"); for a profitable run
   * it's the same ratio (<1, headroom). undefined when grossProfit is 0/unknown.
   */
  multipleFromBreakeven: number | undefined;
  /** The lever with the smallest reachable required change — what to fix first. */
  bindingConstraintKey: Lever["key"] | undefined;
  /** Verbatim summary string for the UI. */
  summary: string;
}

export interface LeverageReport {
  verdict: Verdict;
  /** Levers ranked best-leverage first (reachable, smallest change). */
  levers: Lever[];
}

/** Tunables for reachability judgments. Exported + test-pinned. */
export const LEVERAGE_GUARDS = {
  /**
   * A run whose totalProfit is within this fraction of spend of zero is
   * "marginal" rather than a clear scale/hold. 0.05 = within ±5% of spend.
   */
  marginalBand: 0.05,
  /**
   * Max realistic single-lever increase factor for CVR/AOV. Beyond this the lift
   * is a structural change (new funnel, new product), not a tuning knob, so the
   * lever is flagged unreachable-on-its-own.
   */
  maxLiftFactor: 3,
  /**
   * Max realistic cost CUT: cost can drop at most this fraction (0.5 = down to
   * 50% of current). A required cost factor below (1 − maxCostCut) is unreachable.
   */
  maxCostCut: 0.5,
} as const;

/** The cost lever's current value for the scenario's model. */
function currentCost(scenario: Scenario): number | undefined {
  if (scenario.model === "cps") return scenario.targetCpa;
  return effectiveCpc(scenario);
}

/** Current conversion rate for the run (click or session grain). */
function currentCvr(scenario: Scenario): number | undefined {
  if (scenario.clickCvr !== undefined) return scenario.clickCvr;
  return scenario.sessionCvr;
}

/**
 * Build the levers with real-unit break-even thresholds + profit sensitivity.
 *
 * Shared factors: `linearFactor` (= spend / grossProfit) for the LINEAR levers
 * (CVR/AOV/margin all scale grossProfit linearly, so they share it);
 * `costFactor` (= grossProfit / spend) for the RECIPROCAL cost lever.
 *
 * Per lever we also derive:
 *  - breakEvenValue = currentValue × factor (the real floor/ceiling), and
 *  - profitPerStep = the local derivative of totalProfit w.r.t. the lever, ×
 *    one natural step. Because profit = grossProfit − spend and grossProfit is
 *    linear in each lift lever, dProfit/dValue = grossProfit / currentValue;
 *    for the cost lever grossProfit ∝ 1/cost so dProfit/dCost = −grossProfit /
 *    cost. These give honest, lever-specific numbers (CVR/AOV/margin share a
 *    factor but differ in real units and €/step), breaking the apparent tie.
 */
function buildLevers(scenario: Scenario, projection: Projection): Lever[] {
  const gp = projection.grossProfit;
  const spend = scenario.spend;
  const haveRatio = gp !== undefined && gp > 0 && spend > 0;
  const linearFactor = haveRatio ? spend / (gp as number) : undefined;
  const costFactor = haveRatio ? (gp as number) / spend : undefined;
  const g = gp as number | undefined;

  const liftReachable = (f: number | undefined) =>
    f !== undefined && f <= LEVERAGE_GUARDS.maxLiftFactor;

  const reqMargin =
    linearFactor === undefined ? undefined : scenario.grossMargin * linearFactor;
  const marginReachable =
    reqMargin !== undefined && reqMargin <= 1 && liftReachable(linearFactor);
  const costReachable =
    costFactor !== undefined && costFactor >= 1 - LEVERAGE_GUARDS.maxCostCut;

  const cost = currentCost(scenario);
  const costLabel = scenario.model === "cps" ? "Target CPA" : "Click price (CPC/CPM)";

  // dProfit per natural step. Lift levers: +1pp (pct) or +€1 (aov). Cost: +€1.
  const cvrVal = currentCvr(scenario);
  const perStep = (current: number | undefined): number | undefined =>
    g !== undefined && current !== undefined && current > 0 ? g / current : undefined;

  const lift = (
    key: Lever["key"],
    label: string,
    unit: LeverUnit,
    current: number | undefined,
    stepUnit: number, // natural step in the lever's own units (0.01 = 1pp, 1 = €1)
    reachable: boolean,
    overrideNote?: string,
  ): Lever => {
    const breakEvenValue =
      current !== undefined && linearFactor !== undefined ? current * linearFactor : undefined;
    // profit per natural step = (dProfit/dValue) × stepUnit = (g/current) × stepUnit.
    const slope = perStep(current);
    const profitPerStep = slope !== undefined ? slope * stepUnit : undefined;
    return {
      key,
      label,
      unit,
      currentValue: current,
      breakEvenValue,
      profitPerStep,
      stepLabel: unit === "pct" ? "+1pp" : "+€1",
      factor: linearFactor,
      reachable,
      binding: false,
      note: overrideNote ?? liftNote(current, breakEvenValue, profitPerStep, unit),
    };
  };

  const levers: Lever[] = [
    // Conversion rate is a controllable lever only in the traffic (cpc/cpm)
    // models. In conversion-bid (cps) the operator buys conversions directly at
    // a target CPA — there is no CVR input — so the cost (target-CPA) lever IS
    // the conversion economics; a CVR lever there would be "not computable".
    ...(cvrVal !== undefined
      ? [lift("cvr", "Conversion rate", "pct", cvrVal, 0.01, liftReachable(linearFactor))]
      : []),
    lift("aov", "Average order value", "eur", scenario.aov, 1, liftReachable(linearFactor)),
    lift(
      "grossMargin",
      "Gross margin",
      "pct",
      scenario.grossMargin,
      0.01,
      marginReachable,
      reqMargin !== undefined && reqMargin > 1
        ? `would need ${(reqMargin * 100).toFixed(0)}% margin — impossible (>100%)`
        : undefined,
    ),
  ];

  if (cost !== undefined) {
    const breakEvenCost =
      costFactor !== undefined ? cost * costFactor : undefined;
    const slope = g !== undefined && cost > 0 ? -g / cost : undefined; // dProfit/dCost < 0
    levers.push({
      key: "cost",
      label: costLabel,
      unit: "eur",
      currentValue: cost,
      breakEvenValue: breakEvenCost,
      profitPerStep: slope, // already per +€1
      stepLabel: "+€1",
      factor: costFactor,
      reachable: costReachable,
      binding: false,
      note: costNote(cost, breakEvenCost, slope),
    });
  }

  return levers;
}

/** Format a value in its unit. */
function fmt(v: number | undefined, unit: LeverUnit): string {
  if (v === undefined) return "—";
  return unit === "pct" ? `${(v * 100).toFixed(2)}%` : `€${v.toFixed(2)}`;
}

/**
 * Note for a LIFT lever (CVR/AOV/margin): lead with the real break-even floor vs
 * the current value, then the profit sensitivity per natural step. Concrete and
 * lever-specific even though the three share a multiplicative factor.
 */
function liftNote(
  current: number | undefined,
  breakEven: number | undefined,
  profitPerStep: number | undefined,
  unit: LeverUnit,
): string {
  if (current === undefined || breakEven === undefined) return "not computable";
  const sens =
    profitPerStep === undefined
      ? ""
      : ` · ${unit === "pct" ? "+1pp" : "+€1"} → ${profitPerStep >= 0 ? "+" : "−"}€${Math.abs(profitPerStep).toFixed(0)} profit`;
  if (breakEven <= current) {
    // Profitable: floor is below current — state the floor.
    return `floor ${fmt(breakEven, unit)} (now ${fmt(current, unit)})${sens}`;
  }
  // Losing: must rise to the break-even floor.
  return `must reach ${fmt(breakEven, unit)} (now ${fmt(current, unit)})${sens}`;
}

/**
 * Note for the COST lever: lead with the real break-even ceiling vs current,
 * then sensitivity. Higher cost = less profit, so the relationship inverts.
 */
function costNote(
  current: number | undefined,
  breakEven: number | undefined,
  profitPerStep: number | undefined,
): string {
  if (current === undefined || breakEven === undefined) return "not computable";
  const sens =
    profitPerStep === undefined
      ? ""
      : ` · +€1 → ${profitPerStep >= 0 ? "+" : "−"}€${Math.abs(profitPerStep).toFixed(0)} profit`;
  if (breakEven >= current) {
    // Profitable: ceiling is above current — state the ceiling.
    return `ceiling €${breakEven.toFixed(2)} (now €${current.toFixed(2)})${sens}`;
  }
  // Losing: must drop to the break-even ceiling.
  return `must drop to €${breakEven.toFixed(2)} (now €${current.toFixed(2)})${sens}`;
}

/**
 * Rank levers for "what to fix first": reachable levers before unreachable ones,
 * then by smallest required change (closest to 1.0 wins). Stable, immutable.
 */
function rankLevers(levers: Lever[]): Lever[] {
  const distance = (l: Lever) =>
    l.factor === undefined ? Infinity : Math.abs(Math.log(l.factor));
  return [...levers].sort((a, b) => {
    if (a.reachable !== b.reachable) return a.reachable ? -1 : 1;
    return distance(a) - distance(b);
  });
}

/**
 * Optional real-world context the verdict can't derive from the scenario alone.
 */
export interface LeverageContext {
  /**
   * The CPA the CURRENT funnel can actually deliver — baseline CPC ÷ baseline
   * click-CVR. In conversion-bid (cps) mode the scenario's target CPA is an
   * ASPIRATION; if the funnel can only deliver a far higher CPA, a target at or
   * below break-even is not achievable and the verdict must say HOLD regardless
   * of how profitable that target *would* be. Undefined when not known.
   */
  achievableCpa?: number;
}

/**
 * Produce the full leverage report (verdict + ranked levers) for a scenario.
 * Runs the projection internally so callers pass only the scenario (+ optional
 * real-world context like the funnel's achievable CPA).
 */
export function analyzeLeverage(
  scenario: Scenario,
  context: LeverageContext = {},
): LeverageReport {
  const projection = runProjection(scenario);
  const gp = projection.grossProfit;
  const spend = scenario.spend;
  const totalProfit = projection.totalProfit;

  const multipleFromBreakeven =
    gp !== undefined && gp > 0 && spend > 0 ? spend / gp : undefined;

  // Status from totalProfit relative to a small band around zero (± marginalBand
  // × spend). At/above zero (outside the band) = scale; within = marginal; below
  // = hold.
  const band = LEVERAGE_GUARDS.marginalBand * spend;
  let status: Verdict["status"];
  if (totalProfit === undefined) status = "hold";
  else if (totalProfit > band) status = "scale";
  else if (totalProfit >= -band) status = "marginal";
  else status = "hold";

  // ACHIEVABILITY GATE (conversion-bid): a target CPA only matters if the funnel
  // can hit it. If the achievable CPA (CPC ÷ CVR) is materially above the target,
  // the "profitable at this target" reading is a mirage — force HOLD.
  const targetCpa = scenario.targetCpa;
  const achievableCpa = context.achievableCpa;
  const targetUnachievable =
    scenario.model === "cps" &&
    targetCpa !== undefined &&
    achievableCpa !== undefined &&
    achievableCpa > targetCpa * (1 + LEVERAGE_GUARDS.marginalBand);
  if (targetUnachievable) status = "hold";

  const built = buildLevers(scenario, projection);
  const ranked = rankLevers(built);
  // Binding = the lever to watch/fix first: thinnest margin of safety. When
  // profitable, that's the lever closest to its break-even threshold; when
  // losing, the smallest reachable required change. rankLevers already orders by
  // |log(factor)| within reachability, so the first entry is the binding one.
  // The cost lever and a lift lever can tie on |log(factor)| (reciprocal); break
  // the tie toward the lever the operator can actually move (cost for cps).
  const bindingLever = ranked.find((l) => l.reachable) ?? ranked[0];
  const binding = bindingLever
    ? { ...bindingLever, binding: true }
    : undefined;
  // Re-mark the binding lever in the ranked list (immutable).
  const leversOut = ranked.map((l) =>
    l.key === binding?.key ? { ...l, binding: true } : l,
  );

  return {
    verdict: {
      status,
      multipleFromBreakeven,
      bindingConstraintKey: targetUnachievable ? "cvr" : binding?.key,
      summary: buildSummary(status, multipleFromBreakeven, binding, scenario, {
        targetUnachievable,
        targetCpa,
        achievableCpa,
      }),
    },
    levers: leversOut,
  };
}

/** Compose the verbatim verdict summary the UI renders. */
function buildSummary(
  status: Verdict["status"],
  multiple: number | undefined,
  binding: Lever | undefined,
  scenario: Scenario,
  achievability: {
    targetUnachievable: boolean;
    targetCpa: number | undefined;
    achievableCpa: number | undefined;
  } = { targetUnachievable: false, targetCpa: undefined, achievableCpa: undefined },
): string {
  // Conversion-bid: target is profitable on paper but the funnel can't deliver it.
  if (achievability.targetUnachievable) {
    const eur = (v: number | undefined) =>
      v === undefined ? "—" : `€${v.toLocaleString("en-IE", { maximumFractionDigits: 0 })}`;
    const mult =
      achievability.achievableCpa !== undefined &&
      achievability.targetCpa !== undefined &&
      achievability.targetCpa > 0
        ? ` (~${(achievability.achievableCpa / achievability.targetCpa).toFixed(0)}× too costly)`
        : "";
    return (
      `Below break-even — do not scale spend. A target CPA of ` +
      `${eur(achievability.targetCpa)} would be profitable, but your current ` +
      `funnel can only deliver ~${eur(achievability.achievableCpa)} per sale${mult}. ` +
      `The binding constraint is conversion rate, not ad pricing — fix the funnel ` +
      `before scaling.`
    );
  }
  if (status === "scale") {
    const head = multiple !== undefined && multiple > 0
      ? `Profitable — about ${(1 / multiple).toFixed(1)}× over break-even.`
      : "Profitable at these inputs.";
    return `${head} Inputs clear the break-even line; scaling is defensible, but watch the diminishing-returns caveat as budget rises.`;
  }
  if (status === "marginal") {
    return "Right at break-even — profit is within a few percent of zero. Too close to scale on; small input swings flip the sign. Tighten the binding lever first.";
  }
  // hold
  const x =
    multiple !== undefined ? `~${multiple.toFixed(multiple >= 10 ? 0 : 1)}× below break-even` : "below break-even";
  const lever = binding
    ? ` The binding constraint is ${binding.label.toLowerCase()} (${binding.note}).`
    : "";
  const costName = scenario.model === "cps" ? "the target CPA" : "ad pricing";
  const efficiencyAside =
    binding && binding.key !== "cost"
      ? ` ${costName[0].toUpperCase()}${costName.slice(1)} is already efficient, so tuning it won't help.`
      : "";
  return `Below break-even — do not scale spend (${x}).${lever}${efficiencyAside}`;
}
