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
 *   grossProfit = conversions × netAov × contributionMargin.
 *   - CVR, AOV, contributionMargin are LINEAR in grossProfit. To bring grossProfit up
 *     to spend, multiply the lever by  spend / grossProfit. (contributionMargin is
 *     additionally capped at 1.0 — you can't have >100% margin — so its required
 *     factor may be unreachable.)
 *   - The COST lever (targetCpa for cps; effective CPC for cpc/cpm) is INVERSE:
 *     conversions ∝ 1/cost, so grossProfit ∝ 1/cost. To raise grossProfit to
 *     spend, the cost must shrink to  grossProfit / spend  of its current value.
 *   These are verified in the tests by applying each factor back through
 *   runProjection and asserting totalProfit ≈ 0.
 */

import { runProjection, effectiveCpc, breakEvenCpa } from "./adEconomics";
import { LEARNING_PHASE, type Projection, type Scenario } from "./adScenario";

/** Display unit for a lever's real-world values. */
export type LeverUnit = "pct" | "eur";

/** A lever the operator can move, with its break-even threshold + profit sensitivity. */
export interface Lever {
  /** Stable key for the lever. */
  key: "cvr" | "aov" | "contributionMargin" | "cost";
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
  /**
   * The reachable lever to fix/watch first, or undefined when NO lever can reach
   * break-even on its own (a deeply-losing run). When undefined, the UI shows a
   * "no single lever fixes this" banner instead of highlighting one — never point
   * the operator at an impossible lever (e.g. a >100% margin) as the thing to do.
   */
  bindingConstraintKey: Lever["key"] | undefined;
  /**
   * True when no lever is reachable on its own — the funnel needs structural work,
   * not a single tune. Drives the banner + suppresses the "watch" highlight.
   */
  noReachableLever: boolean;
  /** Verbatim summary string for the UI. */
  summary: string;
}

/**
 * A concrete "what should I actually do" recommendation, synthesized from the
 * constraints the model already computes (break-even CPA = ceiling, learning-
 * phase floor). Turns the calculator into an advisor.
 */
export interface Recommendation {
  /**
   * "spend" — there's a profitable, learnable plan; "hold" — no profitable
   * target exists at the current funnel, fix it first.
   */
  action: "spend" | "hold";
  /** Recommended target CPA, EUR — a safety margin below break-even. undefined when holding. */
  targetCpa: number | undefined;
  /**
   * Recommended starting daily budget, EUR — the learning-phase floor at the
   * recommended CPA, so Meta gets enough conversions to optimize. undefined when holding.
   */
  dailyBudget: number | undefined;
  /** Verbatim one/two-line recommendation for the UI. */
  summary: string;
}

export interface LeverageReport {
  verdict: Verdict;
  /** Levers ranked best-leverage first (reachable, smallest change). */
  levers: Lever[];
  /** Concrete budget/CPA recommendation (advisor layer). */
  recommendation: Recommendation;
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
  /**
   * Safety margin for the recommended target CPA: bid this fraction of break-even
   * CPA so a thin scenario isn't recommended right on the knife-edge. 0.8 = bid
   * 20% below break-even, leaving a buffer for CPA drift / attribution loss.
   */
  recommendedCpaOfBreakeven: 0.8,
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
function buildLevers(
  scenario: Scenario,
  projection: Projection,
  context: LeverageContext = {},
): Lever[] {
  // In conversion-bid (cps) the scenario's targetCpa is DERIVED from the CVR
  // field, which may be optimistic — so `projection` can describe a funnel that
  // doesn't exist. For lever purposes we want the MEASURED reality: re-run the
  // funnel at the achievable CPA the funnel actually delivers, so every lever
  // (lift factors AND the CVR slope) is anchored to the same real funnel and the
  // table can't simultaneously say "AOV is nearly fine" (optimistic) and "CVR is
  // hopeless" (measured). For cpc/cpm, `projection` already IS the reality.
  const basis =
    scenario.model === "cps" && context.achievableCpa !== undefined
      ? runProjection({ ...scenario, targetCpa: context.achievableCpa })
      : projection;
  const gp = basis.grossProfit;
  const spend = scenario.spend;
  const haveRatio = gp !== undefined && gp > 0 && spend > 0;
  const linearFactor = haveRatio ? spend / (gp as number) : undefined;
  const costFactor = haveRatio ? (gp as number) / spend : undefined;
  const g = gp as number | undefined;

  const liftReachable = (f: number | undefined) =>
    f !== undefined && f <= LEVERAGE_GUARDS.maxLiftFactor;

  const reqMargin =
    linearFactor === undefined ? undefined : scenario.contributionMargin * linearFactor;
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
      "contributionMargin",
      "Contribution margin",
      "pct",
      scenario.contributionMargin,
      0.01,
      marginReachable,
      reqMargin !== undefined && reqMargin > 1
        ? `would need ${(reqMargin * 100).toFixed(0)}% margin — impossible (>100%)`
        : undefined,
    ),
  ];

  // CONVERSION-RATE lever for conversion-bid (cps). The CPA there is DERIVED from
  // CVR (achievable CPA = CPC ÷ CVR), so a "target CPA" lever is self-referential
  // and contradicts the verdict ("the constraint is conversion rate"). Instead,
  // when the caller supplies the measured CVR + achievable CPA, express the real
  // lever: the funnel's CURRENT CVR vs the CVR it must reach to break even.
  //   required CVR = measuredCVR × (achievableCPA ÷ break-even CPA)
  // (achievable CPA ∝ 1/CVR, so to bring achievable down to break-even CPA, CVR
  // must rise by that ratio). This is the honest, controllable constraint.
  if (scenario.model === "cps") {
    const beCpa = breakEvenCpa(scenario);
    const measured = context.measuredCvr;
    const achievable = context.achievableCpa;
    if (measured !== undefined && measured > 0 && achievable !== undefined && beCpa !== undefined && beCpa > 0) {
      const requiredCvr = measured * (achievable / beCpa);
      const factor = requiredCvr / measured; // >1 = must rise
      const reachable = factor <= LEVERAGE_GUARDS.maxLiftFactor;
      // Profit moves linearly with CVR (more conversions for the same budget);
      // per +1pp, dProfit ≈ grossProfit/CVR × 0.01 at the modeled rate.
      const slope = g !== undefined ? (g / measured) * 0.01 : undefined;
      levers.push({
        key: "cvr",
        label: "Conversion rate",
        unit: "pct",
        currentValue: measured,
        breakEvenValue: requiredCvr,
        profitPerStep: slope,
        stepLabel: "+1pp",
        factor,
        reachable,
        binding: false,
        note: liftNote(measured, requiredCvr, slope, "pct"),
      });
    }
  } else if (cost !== undefined) {
    // Traffic models (cpc/cpm): the cost lever IS a real input (CPC / CPM price).
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
 * Rank levers by REAL-WORLD margin of safety — the lever whose one natural step
 * (+1pp CVR/margin, +€1 AOV/cost) moves profit the most is the one to watch
 * first. This is the honest "binding constraint": all three LIFT levers share
 * the same multiplicative break-even `factor` (moving any of them by the same
 * fraction has identical effect), so ranking on `factor` ties them and the pick
 * collapses to array order. `profitPerStep` is genuinely lever-specific — it's
 * the €-impact of the unit the operator actually controls (you move CVR by
 * points, not by multiplying it) — so it breaks the tie meaningfully.
 *
 * Reachability still leads: a lever you cannot move on its own is never the
 * thing to "fix first", so reachable levers rank ahead of unreachable ones.
 * Within a reachability tier, larger |profitPerStep| wins (most sensitive to a
 * one-step real-world move). Levers with no computable sensitivity sort last.
 * Stable, immutable.
 */
function rankLevers(levers: Lever[]): Lever[] {
  const sensitivity = (l: Lever) =>
    l.profitPerStep === undefined ? -Infinity : Math.abs(l.profitPerStep);
  return [...levers].sort((a, b) => {
    if (a.reachable !== b.reachable) return a.reachable ? -1 : 1;
    return sensitivity(b) - sensitivity(a);
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
  /**
   * The funnel's MEASURED conversion rate (decimal). In conversion-bid (cps)
   * mode the CPA is derived from CVR, not a free input — so the honest lever is
   * conversion rate, not "target CPA". When supplied (with achievableCpa), the
   * cps lever table shows a real Conversion-rate row (now vs the rate needed to
   * break even) instead of the derived, self-referential Target-CPA row.
   */
  measuredCvr?: number;
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

  // ACHIEVABILITY GATE (conversion-bid). The honest question is: can the funnel
  // deliver a PROFITABLE cost per sale? That's `achievable CPA ≤ break-even CPA`.
  // We key the gate off break-even — NOT off the scenario's targetCpa — because
  // targetCpa is now DERIVED from the (possibly optimistic) CVR field, so
  // comparing achievable-vs-target reduced to "is the CVR field above the
  // measured rate?", which made the gate a no-op in the common default state
  // (CVR field == measured) and only fire when the user typed an optimistic CVR.
  // Comparing against break-even makes the "your funnel can't pay for ads"
  // verdict fire whenever it's actually true, regardless of what CVR is modeled.
  const targetCpa = scenario.targetCpa;
  const achievableCpa = context.achievableCpa;
  const beCpaForGate = breakEvenCpa(scenario);
  const targetUnachievable =
    scenario.model === "cps" &&
    achievableCpa !== undefined &&
    beCpaForGate !== undefined &&
    beCpaForGate > 0 &&
    achievableCpa > beCpaForGate * (1 + LEVERAGE_GUARDS.marginalBand);
  if (targetUnachievable) status = "hold";

  const built = buildLevers(scenario, projection, context);
  const ranked = rankLevers(built);
  // Binding = the lever to watch/fix first.
  //
  // ACHIEVABILITY OVERRIDE (cps): when the gate has fired, the funnel's
  // conversion rate IS the constraint — the verdict says so, so the CVR row must
  // be the highlighted one even though it's "unreachable" (it's the answer, not
  // a tuning knob). This keeps the headline and the table in agreement.
  //
  // Otherwise: the reachable lever whose one natural step moves profit the most
  // (rankLevers orders reachable levers by descending |profitPerStep|). When NO
  // lever is reachable on its own, there is no honest single thing to "watch" —
  // mark none and let the UI show the "needs structural work" banner instead of
  // pointing at an impossible lever.
  const cvrRow = targetUnachievable ? ranked.find((l) => l.key === "cvr") : undefined;
  const bindingLever = cvrRow ?? ranked.find((l) => l.reachable);
  const noReachableLever = bindingLever === undefined;
  const binding = bindingLever
    ? { ...bindingLever, binding: true }
    : undefined;
  // Re-mark the binding lever in the ranked list (immutable). No-op when none.
  const leversOut = ranked.map((l) =>
    l.key === binding?.key ? { ...l, binding: true } : l,
  );

  return {
    verdict: {
      status,
      multipleFromBreakeven,
      // When the achievability gate fires, conversion rate is the constraint by
      // definition — report it as binding even if the caller didn't supply the
      // measured CVR needed to render a CVR row.
      bindingConstraintKey: targetUnachievable ? "cvr" : binding?.key,
      // The CVR row carries the message when the gate fires, so it's not a
      // "no single lever" situation — the banner only shows when truly nothing
      // is the answer.
      noReachableLever: binding === undefined && !targetUnachievable ? noReachableLever : false,
      summary: buildSummary(status, multipleFromBreakeven, binding, scenario, {
        targetUnachievable,
        targetCpa,
        achievableCpa,
        noReachableLever,
      }),
    },
    levers: leversOut,
    recommendation: recommend(scenario, achievableCpa),
  };
}

/**
 * Synthesize a concrete budget/CPA recommendation from the model's own
 * constraints — break-even CPA (the ceiling) and the learning-phase floor.
 *
 * Logic:
 *  - The most you can pay and not lose money is the break-even CPA. Recommend a
 *    target a safety margin below it (recommendedCpaOfBreakeven) so you're not
 *    bidding on the knife-edge.
 *  - But a target is only real if the funnel can DELIVER it. If the achievable
 *    CPA (CPC ÷ CVR) is above the recommended target, no profitable, deliverable
 *    plan exists → action "hold": fix the funnel first, with the CVR needed to
 *    make the recommended CPA achievable.
 *  - When spendable, the starting daily budget is the learning-phase floor at the
 *    recommended CPA: (LEARNING_PHASE.conversions / windowDays) × CPA — enough
 *    daily conversions for Meta to exit "Learning Limited" and optimize.
 *
 * `achievableCpa` is the funnel's deliverable CPA (from context); when unknown
 * (non-cps, or no baseline), the deliverability check is skipped and the
 * recommendation rests on break-even alone.
 */
export function recommend(
  scenario: Scenario,
  achievableCpa: number | undefined,
): Recommendation {
  const be = breakEvenCpa(scenario);
  if (be === undefined || be <= 0) {
    return {
      action: "hold",
      targetCpa: undefined,
      dailyBudget: undefined,
      summary: "No positive contribution per sale at these inputs — fix margin / AOV before spending.",
    };
  }

  const recCpa = be * LEVERAGE_GUARDS.recommendedCpaOfBreakeven;
  const dailyFloor =
    (LEARNING_PHASE.conversions / LEARNING_PHASE.windowDays) * recCpa;
  const eur0 = (v: number) => `€${Math.round(v).toLocaleString("en-IE")}`;
  const eur2 = (v: number) => `€${v.toFixed(2)}`;

  // Deliverability: in cps mode the funnel must hit the recommended CPA.
  const deliverable = achievableCpa === undefined || achievableCpa <= recCpa;
  if (!deliverable) {
    // CVR needed to make recCpa achievable: achievableCpa scales as CPC ÷ CVR,
    // so requiredCvr = currentCvr × (achievableCpa / recCpa). Express as the
    // multiple, since current CVR may be a provisional input.
    const cvrMultiple = (achievableCpa as number) / recCpa;
    return {
      action: "hold",
      targetCpa: recCpa,
      dailyBudget: undefined,
      summary:
        `Don't spend yet. A viable target is ${eur2(recCpa)} CPA (20% under the ` +
        `${eur2(be)} break-even), but your funnel can only deliver ${eur0(achievableCpa as number)} ` +
        `per sale — conversion rate must rise ~${cvrMultiple.toFixed(1)}× first. Fix the funnel, then spend.`,
    };
  }

  return {
    action: "spend",
    targetCpa: recCpa,
    dailyBudget: dailyFloor,
    summary:
      `Start at ${eur0(dailyFloor)}/day targeting ${eur2(recCpa)} CPA ` +
      `(20% under the ${eur2(be)} break-even). The daily figure is the learning-phase ` +
      `floor (~${LEARNING_PHASE.conversions} conversions/${LEARNING_PHASE.windowDays}d) so Meta can optimize; ` +
      `scale up only while CPA holds — watch the diminishing-returns caveat.`,
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
    noReachableLever?: boolean;
  } = { targetUnachievable: false, targetCpa: undefined, achievableCpa: undefined },
): string {
  // Conversion-bid: target is profitable on paper but the funnel can't deliver it.
  // Keep this to ONE plain sentence — the recommendation below carries the numbers
  // (target CPA, required CVR lift) and the lever table shows now → needs. Saying
  // the same figures here too is what made the panel read as redundant.
  if (achievability.targetUnachievable) {
    return (
      "Your funnel can't pay for ads yet. Conversion rate is too low to hit a " +
      "profitable cost per sale — fix the funnel before spending (details below)."
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
    multiple !== undefined
      ? `${multiple.toFixed(multiple >= 10 ? 0 : 1)}× below break-even`
      : "below break-even";

  // No reachable lever: the funnel needs structural work, not a single tune.
  // Keep it to one clean sentence — the lever table shows the per-lever figures
  // and the banner spells out "no single lever fixes this".
  if (achievability.noReachableLever || !binding) {
    return `Below break-even (${x}) — do not scale. No single input can cross the line on its own; the funnel needs structural work before paid pays off.`;
  }

  // One reachable binding lever: name it, its current→target, and its leverage.
  // binding.note already reads "must reach €X (now €Y) · +1pp → +€Z profit".
  return `Below break-even (${x}) — do not scale. Highest-leverage fix: ${binding.label.toLowerCase()} — ${binding.note}.`;
}
