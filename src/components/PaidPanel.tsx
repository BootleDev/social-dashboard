"use client";

import { useEffect, useMemo, useState } from "react";
import type { DailyAdRow, ShopifySalesRow } from "@/lib/adBaseline";
import { resolveScenario, simulate, type ScenarioOverrides } from "@/lib/adSimulate";
import { forecastTraffic } from "@/lib/adEconomics";
import { analyzeLeverage } from "@/lib/adLeverage";
import {
  DEFAULT_VAT_RATE,
  DEFAULT_CONTRIBUTION_MARGIN,
  PROVISIONAL_SESSION_CVR,
  PROVISIONAL_CVR_AS_OF,
  PROVISIONAL_ATC_RATE,
  type Baseline,
  type EstimateWithConfidence,
  type PricingModel,
} from "@/lib/adScenario";
import { rankCandidates, candidateRationale, type CandidateSortKey } from "@/lib/adCandidate";
import { toPost } from "@/lib/types";
import { resolveViewUrl } from "@/lib/viewUrl";
import { getPlatformConfig } from "@/lib/platforms";
import { usePersistedState } from "@/lib/usePersistedState";
import { setPaidChatContext } from "@/lib/paidChatContext";
import InfoTooltip from "./InfoTooltip";
import Collapsible from "./paid/Collapsible";
import LeveragePanel from "./paid/LeveragePanel";
import {
  card,
  eur,
  int,
  pct,
  ratio,
  pctPlain,
  Metric,
  Field,
  NumField,
  TextField,
  ReadonlyField,
  Row,
  Callout,
} from "./paid/primitives";
import type { AirtableRecord } from "@/lib/utils";

interface PaidApiResponse {
  baseline: Baseline;
  /** Store AOV pooled over ALL (fresh) Shopify rows, comp-excluded. */
  freshShopifyAov?: EstimateWithConfidence;
  daily: DailyAdRow[];
  shopify: ShopifySalesRow[];
  window: { start: string; end: string };
}

interface PaidPanelProps {
  /** Organic posts already loaded by the dashboard — reused as ad candidates. */
  posts: AirtableRecord[];
}

/** Friendly model labels for headers. */
const MODEL_LABEL: Record<PricingModel, string> = {
  cps: "conversion bid",
  cpc: "CPC",
  cpm: "CPM",
};

/** Render a span of days as a human duration: "~9 days", "~3 weeks", "~5 months". */
function humanDuration(days: number): string {
  if (days < 1) return "under a day";
  if (days <= 21) return `~${Math.ceil(days)} day${Math.ceil(days) === 1 ? "" : "s"}`;
  if (days <= 90) return `~${Math.round(days / 7)} weeks`;
  if (days < 365) return `~${Math.round(days / 30)} months`;
  const yrs = days / 365;
  return yrs >= 2 ? `~${Math.round(yrs)} years` : "~1 year+";
}

/**
 * One A/B-feasibility row: a plain verdict (feasible / slow / not feasible) from
 * how long it takes, the human duration, and a short what-it-is sub-line. Keeps
 * the statistics out of sight — the operator just sees "yes, in ~3 weeks" or
 * "no, would take months".
 */
function TestRow({
  label,
  sub,
  days,
}: {
  label: string;
  sub: string;
  days: number | undefined;
}) {
  // Thresholds: ≤30d feasible, ≤90d slow-but-possible, else not worth it.
  const verdict =
    days === undefined
      ? { glyph: "✗", word: "not feasible", color: "var(--danger, #dc2626)", detail: "not enough traffic" }
      : days <= 30
        ? { glyph: "✓", word: "feasible", color: "var(--success, #16a34a)", detail: humanDuration(days) }
        : days <= 90
          ? { glyph: "~", word: "slow", color: "var(--warning, #d97706)", detail: humanDuration(days) }
          : { glyph: "✗", word: "not worth it", color: "var(--danger, #dc2626)", detail: humanDuration(days) };
  return (
    <div
      className="flex items-center justify-between gap-3 rounded-lg px-3 py-2"
      style={{ background: "var(--bg-primary)" }}
    >
      <span className="min-w-0">
        <span className="text-sm inline-flex items-center gap-2">
          <span aria-hidden style={{ color: verdict.color }}>{verdict.glyph}</span>
          {label}
          <span className="text-[11px]" style={{ color: verdict.color }}>— {verdict.word}</span>
        </span>
        <span className="block text-[11px] mt-0.5" style={{ color: "var(--text-secondary)" }}>{sub}</span>
      </span>
      <span className="shrink-0 text-sm tabular-nums" style={{ color: "var(--text-secondary)" }}>
        {verdict.detail}
      </span>
    </div>
  );
}

export default function PaidPanel({ posts }: PaidPanelProps) {
  const [api, setApi] = useState<PaidApiResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Scenario inputs (overrides onto the measured baseline).
  // UNIT CONVENTION: rate fields hold WHOLE PERCENTS (65 = 65%, 20 = 20%, 2 =
  // 2%); money fields hold euros. The engine consumes decimals, so we divide
  // percents by 100 at the override boundary (see the useMemo below). This keeps
  // every rate input consistent and matches how Meta / Google display them.
  // Scenario inputs persist to localStorage so a tuned scenario survives reloads
  // and tab switches (keys namespaced under "paid_*").
  const [model, setModel] = usePersistedState<PricingModel>("paid_model", "cps");
  const [budget, setBudget] = usePersistedState("paid_budget", 500);
  const [contributionMarginPct, setContributionMarginPct] = usePersistedState(
    "paid_contributionMarginPct",
    DEFAULT_CONTRIBUTION_MARGIN * 100,
  );
  const [vatRatePct, setVatRatePct] = usePersistedState("paid_vatRatePct", DEFAULT_VAT_RATE * 100);
  const [ltvMultiplier, setLtvMultiplier] = usePersistedState("paid_ltv", 1.0);
  // Optional manual overrides (empty string = use the baseline value). CVR / CTR
  // overrides are in PERCENT (e.g. "2" = 2%); cpc/cpm/aov are euros.
  const [cvrOverride, setCvrOverride] = usePersistedState("paid_cvr", "");
  const [ctrOverride, setCtrOverride] = usePersistedState("paid_ctr", "");
  const [cpcOverride, setCpcOverride] = usePersistedState("paid_cpc", "");
  const [cpmOverride, setCpmOverride] = usePersistedState("paid_cpm", "");
  const [aovOverride, setAovOverride] = usePersistedState("paid_aov", "");
  // The daily budget the TRAFFIC forecast runs at — a planning knob, separate
  // from the campaign budget. Empty = use the smart default (recommended safe
  // daily spend if one exists, else campaign budget ÷ 30). Never anchored to the
  // loss-making "min daily budget at the achievable CPA".
  const [forecastBudgetOverride, setForecastBudgetOverride] = usePersistedState("paid_forecastBudget", "");

  useEffect(() => {
    let alive = true;
    fetch("/api/paid")
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`))))
      .then((d: PaidApiResponse) => {
        if (alive) {
          setApi(d);
          setLoading(false);
        }
      })
      .catch((e) => {
        if (alive) {
          setError(e instanceof Error ? e.message : "Failed to load");
          setLoading(false);
        }
      });
    return () => {
      alive = false;
    };
  }, []);

  const baseline = api?.baseline ?? null;

  // Conversion-bid (cps) no longer takes a free Target CPA input. The CPA you can
  // actually pay is DERIVED from the funnel — achievable CPA = CPC ÷ CVR — so it
  // can never silently contradict the CVR you set. The operator improves the CPA
  // by improving CVR (or AOV/margin), which is the real causal chain; you don't
  // pick a CPA, you earn it. This removes the old "pinned target CPA" mode whose
  // CVR field went decorative and made the output stop reflecting the input.

  // Reset every scenario lever back to live/measured actuals.
  const resetToActuals = () => {
    setCvrOverride("");
    setAovOverride("");
    setCpcOverride("");
    setCpmOverride("");
    setCtrOverride("");
  };

  // Whether the user has diverged from live actuals (enables the reset button).
  const hasOverrides =
    [cvrOverride, aovOverride, cpcOverride, cpmOverride, ctrOverride].some(
      (s) => s.trim() !== "",
    );

  // Run the simulation whenever inputs change. Errors (e.g. missing baseline
  // input with no override) are surfaced, not thrown into render.
  const { ranged, leverage, forecast, simError } = useMemo(() => {
    if (!baseline) return { ranged: null, simError: null };
    // Parse a euro/number field: "" → undefined (use baseline), else the number.
    const num = (s: string): number | undefined => {
      const n = Number(s);
      return s.trim() !== "" && Number.isFinite(n) ? n : undefined;
    };
    // Parse a PERCENT field into a decimal: "2" → 0.02. "" → undefined.
    const pctNum = (s: string): number | undefined => {
      const n = num(s);
      return n === undefined ? undefined : n / 100;
    };
    // DEFAULT CVR + AOV come from FRESH Shopify data, not the stale ad window
    // (ad spend ended 2026-01-22; Shopify runs to mid-2026):
    //  - CVR defaults to the provisional Shopify storefront session→purchase rate
    //    (all-traffic, not ad-attributed; replace when live GA4 lands per
    //    WEBDEV-103). The stale ad CVR rested on a 5-conversion January sample.
    //  - AOV defaults to the fresh, comp-excluded Shopify store AOV.
    // A user override beats the default in both cases.
    const effectiveCvr = pctNum(cvrOverride) ?? PROVISIONAL_SESSION_CVR;
    const effectiveAov =
      num(aovOverride) ?? api?.freshShopifyAov?.value ?? baseline.aov.value;

    // CPS conversions are bought at a CPA. That CPA is DERIVED, not entered: it's
    // the ACHIEVABLE CPA the funnel delivers at the effective CVR (CPC ÷ CVR), so
    // the projection always models the reality the CVR implies and the verdict /
    // levers / projection stay in agreement. There is no separate Target-CPA
    // input to contradict the CVR. Break-even CPA (the line to beat) is shown
    // separately. CPC is stale, so this is surfaced as a derived, caveated figure.
    const achievableCpaSeed =
      baseline.cpc.value !== undefined && effectiveCvr > 0
        ? baseline.cpc.value / effectiveCvr
        : undefined;
    const targetCpa = model === "cps" ? achievableCpaSeed : undefined;

    const overrides: ScenarioOverrides = {
      model,
      budget,
      targetCpa,
      contributionMargin: contributionMarginPct / 100,
      vatRate: vatRatePct / 100,
      ltvMultiplier,
      // Traffic models use the effective (provisional-or-overridden) CVR; cps
      // ignores clickCvr (it buys conversions directly).
      clickCvr: model === "cps" ? undefined : effectiveCvr,
      ctr: pctNum(ctrOverride),
      cpc: num(cpcOverride),
      cpm: num(cpmOverride),
      aov: effectiveAov,
    };
    // Achievability anchor = the CPA the funnel ACTUALLY delivers today, from the
    // live MEASURED rate (baseline ad CVR if present, else provisional Shopify) —
    // NOT the CVR field, which may have been auto-filled from a pinned Target CPA.
    // This keeps the verdict's reality check ("your funnel can only deliver €X,
    // needs an N× lift") honest even when you're modeling an optimistic CVR.
    const measuredCvr = baseline.clickCvr.value ?? PROVISIONAL_SESSION_CVR;
    const achievableCpa =
      baseline.cpc.value !== undefined && measuredCvr > 0
        ? baseline.cpc.value / measuredCvr
        : undefined;
    try {
      const scenario = resolveScenario(baseline, overrides);
      const lev = analyzeLeverage(scenario, { achievableCpa, measuredCvr });
      const expected = simulate(scenario, { baseline });
      // Daily budget the forecast runs at. Priority:
      //  1. an explicit "forecast at €X/day" override (planning knob), else
      //  2. the recommended SAFE daily spend (only when the verdict says spend), else
      //  3. the campaign budget ÷ 30.
      // Deliberately NOT the old `minDailyBudget` — that was (50/7) × the
      // achievable CPA, i.e. a money-LOSING spend level when the funnel can't
      // deliver, which made the forecast contradict a HOLD verdict.
      const forecastBudgetNum = num(forecastBudgetOverride);
      const dailyBudget =
        forecastBudgetNum ?? lev.recommendation.dailyBudget ?? budget / 30;
      return {
        ranged: expected,
        leverage: lev,
        // cps carries no CPC/CVR, so hand the forecast the baseline CPC + measured
        // CVR (and the provisional add-to-cart rate) so it can derive SITE traffic
        // and A/B feasibility in every mode — ad spend buys real visitors even
        // when you bid on conversions.
        forecast: forecastTraffic(scenario, dailyBudget, {
          cpc: baseline.cpc.value,
          cvr: measuredCvr,
          atcRate: PROVISIONAL_ATC_RATE,
        }),
        simError: null,
      };
    } catch (e) {
      return {
        ranged: null,
        leverage: null,
        forecast: null,
        simError: e instanceof Error ? e.message : "Simulation failed",
      };
    }
  }, [baseline, api, model, budget, contributionMarginPct, vatRatePct, ltvMultiplier, cvrOverride, ctrOverride, cpcOverride, cpmOverride, aovOverride, forecastBudgetOverride]);

  // Candidate ranking from the organic posts already in the dashboard.
  const [candidateSort, setCandidateSort] = useState<CandidateSortKey>("viralityIndex");
  const candidates = useMemo(() => {
    const parsed = posts.map(toPost);
    // Pass nowMs so recent creative outranks stale (recency decay). Captured at
    // render; candidates re-rank if the post set or sort changes.
    return rankCandidates(parsed, { sortBy: candidateSort, nowMs: Date.now() }).slice(0, 12);
  }, [posts, candidateSort]);

  // Effective defaults (render scope, mirror the useMemo): CVR = provisional
  // fresh-Shopify rate unless overridden; AOV = fresh Shopify store AOV unless
  // overridden. Used for placeholders + the context line.
  const aovOverrideNum =
    aovOverride.trim() !== "" && Number.isFinite(Number(aovOverride))
      ? Number(aovOverride)
      : undefined;
  const cvrOverrideDec =
    cvrOverride.trim() !== "" && Number.isFinite(Number(cvrOverride))
      ? Number(cvrOverride) / 100
      : undefined;
  const effectiveCvrDisplay = cvrOverrideDec ?? PROVISIONAL_SESSION_CVR;
  const effectiveAovDisplay =
    aovOverrideNum ?? api?.freshShopifyAov?.value ?? baseline?.aov.value;

  // Two CPAs for conversion-bid mode:
  //  - break-even CPA (net AOV × contribution margin): the most you can pay per sale.
  //  - achievable CPA (CPC ÷ effective CVR): what the funnel forces per sale now.
  // The gap between them is the conversion problem.
  const breakEvenCpaDisplay =
    effectiveAovDisplay !== undefined
      ? (effectiveAovDisplay / (1 + vatRatePct / 100)) * (contributionMarginPct / 100)
      : undefined;
  const impliedBaselineCpa =
    baseline?.cpc.value !== undefined && effectiveCvrDisplay > 0
      ? baseline.cpc.value / effectiveCvrDisplay
      : undefined;
  // Staleness: how old is the latest active ad spend? Shopify is fresh, but the
  // ad price (CPC/CPM/CTR) baseline comes from possibly-months-old spend.
  const latestSpendDate = baseline?.flags.latestSpendDate;
  const spendAgeDays =
    latestSpendDate !== undefined
      ? Math.round((Date.now() - Date.parse(`${latestSpendDate}T00:00:00Z`)) / 86_400_000)
      : undefined;
  const spendIsStale = spendAgeDays !== undefined && spendAgeDays > 30;

  // Publish the live decision context for the dashboard "Ask AI" chat so the user
  // can ask "why HOLD?" / "what should I change?" and get THIS scenario's
  // reasoning. Rebuilt on every recompute; cleared when the Paid tab unmounts.
  // Placed before the loading/error early returns so the hook runs unconditionally.
  useEffect(() => {
    if (!leverage || !ranged || !baseline) {
      setPaidChatContext(null);
      return;
    }
    const v = leverage.verdict;
    const rec = leverage.recommendation;
    const e = ranged.expected;
    setPaidChatContext(
      [
        "PAID AD SIMULATOR — current scenario the user is viewing:",
        `- Mode: ${MODEL_LABEL[model]}, budget €${budget}.`,
        `- Measured baseline (window ${api?.window.start}→${api?.window.end}, ad spend last seen ${baseline.flags.latestSpendDate}): CPC ${eur(baseline.cpc.value)}, CTR ${pct(baseline.ctr.value)}, ad CVR ${pct(baseline.clickCvr.value)}, ad-AOV ${eur(baseline.aov.value)}.`,
        `- Inputs: conversion rate ${pct(effectiveCvrDisplay)} (${cvrOverride.trim() ? "user override" : "provisional Shopify, all-traffic"}), AOV ${eur(effectiveAovDisplay)} (fresh Shopify), contribution margin ${contributionMarginPct}% (on net, after all variable costs), VAT ${vatRatePct}%.`,
        `- Achievable CPA (CPC÷CVR) ${eur(impliedBaselineCpa)} vs break-even CPA ${eur(breakEvenCpaDisplay)}.`,
        `- Projection (expected): ${e.conversions?.toFixed(1)} conversions, revenue ${eur(e.revenue)} (net ${eur(e.netRevenue)}), CPA ${eur(e.cpa)}, attributed ROAS ${ratio(e.roas)}, total profit ${eur(e.totalProfit)}.`,
        `- VERDICT: ${v.status.toUpperCase()}. ${v.summary}`,
        `- RECOMMENDATION: ${rec.action === "spend" ? "DO" : "DON'T"} — ${rec.summary}`,
        "Note: ad pricing (CPC/CPM/CTR) may be stale; conversion rate is provisional (Shopify all-traffic) until live GA4 attribution lands. ROAS is attributed, not incremental. When asked about this scenario, use these figures and explain the reasoning.",
      ].join("\n"),
    );
    return () => setPaidChatContext(null);
  }, [
    leverage, ranged, baseline, model, budget, api,
    effectiveCvrDisplay, effectiveAovDisplay, contributionMarginPct, vatRatePct,
    cvrOverride, impliedBaselineCpa, breakEvenCpaDisplay,
  ]);

  if (loading) return <div style={{ color: "var(--text-secondary)" }}>Loading paid data…</div>;
  if (error)
    return (
      <div style={{ color: "var(--text-secondary)" }}>
        Could not load Marketing Intelligence data: {error}
      </div>
    );

  return (
    <div className="space-y-6">
      {/* Data-freshness banner: the ad-price baseline (CPC/CPM/CTR) is only as
          current as the last spend day. Conversion + AOV now come from fresh
          Shopify, but stale ad pricing is still worth flagging. */}
      {spendIsStale && (
        <div
          className="rounded-xl p-3 text-xs"
          style={{ background: "var(--warning-soft, rgba(217,119,6,0.12))", border: "1px solid var(--warning, #d97706)", color: "var(--text-primary, var(--text-secondary))" }}
        >
          <strong>Ad-pricing baseline is {spendAgeDays} days old.</strong> The last
          recorded ad spend was {latestSpendDate}, so CPC / CPM / CTR reflect that
          campaign, not today. Conversion rate and AOV below use fresh Shopify data
          (to {PROVISIONAL_CVR_AS_OF}); CPC/CPM/CTR will refresh once ads run again.
        </div>
      )}

      {simError && (
        <div className="rounded-xl p-4 text-sm" style={{ ...card, color: "var(--text-secondary)" }}>
          {simError}
        </div>
      )}

      {/* 1. DECISION — the verdict LEADS (answer-first): it's the first card a
          CEO sees. Reads off the persisted scenario, so it renders meaningfully
          on load; the editable inputs and the raw baseline sit below it. */}
      {leverage && (
        <LeveragePanel
          report={leverage}
          cpaAnchor={
            model === "cps"
              ? { achievable: impliedBaselineCpa, breakEven: breakEvenCpaDisplay }
              : undefined
          }
        />
      )}

      {/* 2. Measured baseline — supporting evidence, collapsed by default, BELOW
          the verdict (it's where the inputs' defaults come from, not the answer). */}
      {baseline && (
        <Collapsible
          title="Measured baseline"
          defaultOpen={false}
          tip={`Pooled from real ad history, ${api?.window.start} → ${api?.window.end}. The conversion funnel (CVR + AOV) is ad-attributed and same-source. AOV is gross (incl. VAT); revenue and ROAS stay gross, while profit and break-even use net = AOV ÷ (1 + VAT) at the VAT rate and contribution margin you set.`}
        >
          <div className="grid grid-cols-2 sm:grid-cols-5 gap-4">
            <Metric
              label="CPC"
              value={eur(baseline.cpc.value)}
              conf={baseline.cpc.confidence}
              n={baseline.cpc.n}
              tip="Cost per click, pooled (total spend ÷ total clicks) over the window — the volume-weighted price actually paid, not a mean of daily rates. VAT-neutral."
            />
            <Metric
              label="CTR"
              value={pct(baseline.ctr.value)}
              conf={baseline.ctr.confidence}
              n={baseline.ctr.n}
              tip="Click-through rate, pooled (total clicks ÷ total impressions). Drives the CPM model's click count."
            />
            <Metric
              label="Click CVR"
              value={pct(baseline.clickCvr.value)}
              conf={baseline.clickCvr.confidence}
              n={baseline.clickCvr.n}
              tip="Ad-attributed conversion rate = ad purchases ÷ ad clicks (same-source: both from Ad Snapshots). The 95% range is a Wilson interval — on few conversions the exact rate is uncertain even when the direction is clear."
              sub={
                baseline.clickCvrInterval
                  ? `95% ${pct(baseline.clickCvrInterval.low)}–${pct(baseline.clickCvrInterval.high)} · from ${baseline.counts.adPurchases} conv.`
                  : undefined
              }
            />
            <Metric
              label="AOV (ad-attr., incl. VAT)"
              value={eur(baseline.aov.value)}
              conf={baseline.aov.confidence}
              n={baseline.aov.n}
              tip="Average order value, GROSS (what the customer paid, VAT included) — from Meta's ad-attributed purchase value. Revenue/ROAS use this gross figure; profit/break-even use net = AOV ÷ (1 + VAT). 'store-wide' is the whole-store Shopify basket, shown for comparison only."
              sub={`store-wide ${eur(baseline.shopifyAov.value)}`}
            />
            <Metric
              label="CPM"
              value={eur(baseline.cpm.value)}
              conf={baseline.cpm.confidence}
              n={baseline.cpm.n}
              tip="Cost per 1,000 impressions, pooled (total spend ÷ total impressions × 1000). Used by the CPM (Meta) pricing model. VAT-neutral."
            />
          </div>
          {/* Source-disagreement callout: the two conversion counts differ
              legitimately (ad-pixel attribution vs whole-store orders). */}
          <div
            className="mt-4 text-xs rounded-lg p-3"
            style={{ background: "var(--bg-primary)", color: "var(--text-secondary)" }}
          >
            Conversions in window — <strong>{baseline.counts.adPurchases}</strong> ad-attributed
            (Meta pixel, drives CVR) vs <strong>{baseline.counts.storeOrders}</strong> total store
            orders (Shopify). They differ because the pixel only counts purchases it can tie to an
            ad click. CVR/AOV use the ad-attributed figures.
            {baseline.counts.adPurchases < 10 && (
              <>
                {" "}
                <strong>Caution:</strong> CVR rests on only {baseline.counts.adPurchases} conversions —
                the direction (below break-even) is reliable; the exact rate is not. Treat the 95%
                range as the honest spread.
              </>
            )}
          </div>
        </Collapsible>
      )}

      {/* 3. Scenario inputs — open by default for tuning. */}
      <Collapsible
        title="Scenario — adjust the model"
        tip="Rates are entered as percents (margin 50, VAT 20, CVR 2); money fields are euros. Overrides left blank fall back to the measured baseline. Default mode is conversion-bid — how Meta is actually bought in 2026: you set a budget and conversions are bought at the achievable CPA your funnel delivers."
      >
        {/* Bidding basis + reset-to-actuals. */}
        <div className="mb-4 flex items-end justify-between gap-3">
          <div className="max-w-xs flex-1">
          <Field
            label="Bidding basis"
            tip="How spend turns into outcomes. Conversion bid (Meta default): you set budget + a target CPA (cost cap / ROAS goal); conversions = budget ÷ CPA, and CPM/CPC are auction OUTCOMES, not inputs. Pay-per-click: clicks = budget ÷ CPC (search-style). Pay-per-impression: impressions = budget ÷ CPM × 1000, then clicks = impressions × CTR. The CPC/CPM modes are diagnostic — for back-of-envelope click economics."
          >
            <select
              value={model}
              onChange={(e) => setModel(e.target.value as PricingModel)}
              className="w-full rounded px-2 py-1 text-sm"
              style={{ background: "var(--bg-primary)", border: "1px solid var(--border)" }}
            >
              <option value="cps">Conversion bid · target CPA (Meta default)</option>
              <option value="cpc">Pay per click (CPC) · diagnostic</option>
              <option value="cpm">Pay per 1,000 impressions (CPM) · diagnostic</option>
            </select>
          </Field>
          </div>
          {/* Recovery affordance — only shown once you've actually overridden
              something, so it doesn't compete with the bidding selector. */}
          {hasOverrides && (
            <button
              type="button"
              onClick={resetToActuals}
              className="text-xs px-2.5 py-1 rounded transition-colors shrink-0 cursor-pointer"
              style={{
                background: "transparent",
                color: "var(--text-secondary)",
                border: "1px solid var(--border)",
              }}
              title="Clear all overrides and return every input to live / measured data"
            >
              ↺ Reset to actuals
            </button>
          )}
        </div>

        <div className="grid sm:grid-cols-2 gap-x-6 gap-y-2">
          {/* GROUP 1: what you tell the ad platform to do. */}
          <div>
            <div className="text-[11px] font-semibold uppercase tracking-wide mb-2" style={{ color: "var(--text-secondary)" }}>
              What you bid
            </div>
            <div className="grid grid-cols-2 gap-4">
              <NumField
                label="Budget (€)"
                value={budget}
                onChange={setBudget}
                step={50}
                min={0}
                tip="Total ad spend to model. Assumes full delivery (spend = budget)."
              />
              {model === "cps" && (
                <ReadonlyField
                  label="Achievable CPA (€)"
                  value={eur(impliedBaselineCpa)}
                  tip="The cost per sale your funnel can actually deliver = CPC ÷ conversion rate. This is DERIVED, not entered: in conversion-bid mode you don't pick a CPA, you earn it by improving the funnel — so it always matches the conversion rate you set and can never silently contradict it. Compare it against break-even CPA below: above the line, every sale loses money. (CPC is stale — see the freshness banner — so treat this as directional.)"
                />
              )}
              {model === "cpc" && (
                <TextField
                  label="CPC override (€)"
                  value={cpcOverride}
                  onChange={setCpcOverride}
                  placeholder={eur(baseline?.cpc.value)}
                  tip="Override the cost per click (€). Used by the pay-per-click diagnostic model. Leave blank to use the baseline CPC."
                />
              )}
              {model === "cpm" && (
                <>
                  <TextField
                    label="CPM override (€)"
                    value={cpmOverride}
                    onChange={setCpmOverride}
                    placeholder={eur(baseline?.cpm.value)}
                    tip="Override the cost per 1,000 impressions (€). Used by the pay-per-impression diagnostic model. Leave blank to use the baseline CPM."
                  />
                  <TextField
                    label="Link CTR override (%)"
                    value={ctrOverride}
                    onChange={setCtrOverride}
                    placeholder={pctPlain(baseline?.ctr.value)}
                    tip="Override the LINK / outbound CTR, in percent (enter 1 for 1%) — clicks that leave Meta for your site, NOT 'All CTR' (which is ~3-5× higher and includes likes/expands). Median link CTR is ~1%. Leave blank to use the baseline."
                  />
                </>
              )}
            </div>
          </div>

          {/* GROUP 2: the FUNNEL — the two live levers you actually tune. */}
          <div>
            <div className="text-[11px] font-semibold uppercase tracking-wide mb-2" style={{ color: "var(--text-secondary)" }}>
              Your funnel
            </div>
            <div className="grid grid-cols-2 gap-4">
              <TextField
                label="Conversion rate (%)"
                value={cvrOverride}
                onChange={setCvrOverride}
                placeholder={pctPlain(PROVISIONAL_SESSION_CVR)}
                tip={`Session→purchase conversion rate, in percent — the core control in conversion-bid mode. Defaults to ${pct(PROVISIONAL_SESSION_CVR)} — Shopify's all-traffic storefront funnel over the trailing 90 days (to ${PROVISIONAL_CVR_AS_OF}), provisional until live GA4 attribution lands. The achievable CPA (CPC ÷ CVR) is derived from this, so moving it moves the whole projection. The verdict's reality check always compares against your live MEASURED rate, not this field — so an optimistic CVR here won't hide that the funnel can't deliver it. 'Reset to actuals' clears it.`}
              />
              <TextField
                label="AOV (€)"
                value={aovOverride}
                onChange={setAovOverride}
                placeholder={eur(api?.freshShopifyAov?.value ?? baseline?.aov.value)}
                tip="Average order value (€), GROSS / incl. VAT. Defaults to the fresh, comp-excluded Shopify store AOV (current, runs past the stale ad window). Net is derived via the VAT rate. Override to model a different basket."
              />
            </div>
          </div>
        </div>

        {/* GROUP 3: economics constants — set once, rarely touched. Visually
            demoted (smaller header, muted) so the two live funnel levers above
            read as the things to actually tune. */}
        <div className="mt-4 pt-3" style={{ borderTop: "1px dashed var(--border)" }}>
          <div className="text-[11px] font-semibold uppercase tracking-wide mb-2" style={{ color: "var(--text-secondary)" }}>
            Economics — set once{" "}
            <span className="font-normal normal-case opacity-70">
              (your cost structure, not per-campaign levers)
            </span>
          </div>
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-4">
            <NumField
              label="Contribution margin (%)"
              value={contributionMarginPct}
              onChange={setContributionMarginPct}
              step={1}
              min={0}
              max={100}
              tip="Percent of NET (ex-VAT) revenue kept after ALL variable per-order costs — COGS, payment-processing fees (~2.5%), shipping / fulfillment, pick-pack, and a returns provision. This is NOT gross margin (COGS only): an extra ad-driven sale incurs those other costs too, so contribution margin is what actually decides whether the sale pays for its ad cost. Using gross margin would overstate profit and make break-even CPA look too easy. Defaults to a derived ~50% ESTIMATE (gross ~65% minus ~15% other variable costs) — replace it with Bootle's measured figure when you have it. Applied to net AOV, so VAT is never counted as profit."
            />
            <NumField
              label="VAT rate (%)"
              value={vatRatePct}
              onChange={setVatRatePct}
              step={1}
              min={0}
              max={100}
              tip="VAT as a percent of the gross AOV (enter 20 for 20%, UK default). Net AOV = AOV ÷ (1 + VAT). Bootle has no single rate (DE 19, FR 20, IT 22, IE 23, UK 20; variance absorbed at one price band) — adjust to model a specific market. Set 0 for ex-VAT (e.g. US) pricing."
            />
            <NumField
              label="Lifetime value ×"
              value={ltvMultiplier}
              onChange={setLtvMultiplier}
              step={0.05}
              min={1}
              tip="Average lifetime gross profit per acquired customer, as a multiple of their FIRST order (1.0 = no repeat; 1.3 = the cohort's lifetime profit is 1.3× first-order profit). It's a population average per customer — fractional is fine (like '2.3 kids per household'), no single customer buys 0.3 times. CAVEAT: it assumes repeat orders carry the SAME margin/value as the first. For Bootle, repeats are often cheap inner-sets / seal replacements (~€12), so set this LOWER than a naive repeat-order count would suggest. Only affects the '(with LTV)' figures."
            />
          </div>
        </div>

        {/* Compact causal line, right by the CVR input: how the rate you set maps
            to the cost per sale. The full achievable-vs-break-even comparison +
            verdict live in the decision panel above — not repeated here. */}
        {model === "cps" && (
          <div
            className="mt-4 text-[11px]"
            style={{ color: "var(--text-secondary)" }}
          >
            At <strong>{pct(effectiveCvrDisplay)}</strong> conversion, your funnel delivers a{" "}
            <strong>{eur(impliedBaselineCpa)}</strong> cost per sale (CPC {eur(baseline?.cpc.value)} ÷ CVR).
            Raise the rate above to lower it — you don&apos;t set the CPA, the funnel earns it. The
            verdict above shows whether that beats break-even.
          </div>
        )}
      </Collapsible>

      {/* 3. Projection — supporting detail, COLLAPSED by default so the verdict +
          recommendation own the first screen. Expand for the full Low/Expected/
          High table. */}
      {ranged && (
        <Collapsible
          title={`Projection — €${budget} on ${MODEL_LABEL[model]}`}
          defaultOpen={false}
          tip="The full Low / Expected / High sensitivity table: conversions, revenue, CPA, ROAS, profit, and the break-even lines. Expand for the detail behind the verdict."
        >
          {ranged.flags.lowConfidence && (
            <div className="text-[11px] mb-3" style={{ color: "var(--text-secondary)" }}>
              low-confidence baseline · treat as directional
            </div>
          )}
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr style={{ color: "var(--text-secondary)" }} className="text-left text-xs">
                  <th className="py-1 pr-4">Metric</th>
                  <th className="py-1 pr-4">
                    <span className="inline-flex items-center gap-1">
                      Low
                      <InfoTooltip
                        text="Worst case: CVR −35% and price +20% together (fewer, costlier conversions). This is where the biggest loss shows — it is NOT a statistical confidence interval, it's a deterministic 'what if it goes against us' sensitivity range."
                        label="What is Low?"
                      />
                    </span>
                  </th>
                  <th className="py-1 pr-4 font-semibold">Expected</th>
                  <th className="py-1 pr-4">
                    <span className="inline-flex items-center gap-1">
                      High
                      <InfoTooltip
                        text="Best case: CVR +35% and price −20% together (more, cheaper conversions). The optimistic end of the same deterministic sensitivity band."
                        label="What is High?"
                      />
                    </span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {/* Clicks only exist in the traffic (cpc/cpm) models; conversion
                    bid buys results directly, so the row would be a bare "—". */}
                {model !== "cps" && (
                  <Row
                    label="Clicks"
                    pick={(p) => int(p.clicks)}
                    r={ranged}
                    tip="Ad clicks the budget buys. CPC model: budget ÷ CPC. CPM model: (budget ÷ CPM × 1000) × CTR. VAT-neutral."
                  />
                )}
                <Row
                  label="Conversions (sales)"
                  pick={(p) => ratio(p.conversions)}
                  r={ranged}
                  emphasize
                  tip="Projected purchases = clicks × (1 − bounce) × CVR. Kept fractional (0.4 of a sale is a legitimate projection); rounding is display-only."
                />
                <Row
                  label="Revenue (incl. VAT)"
                  pick={(p) => eur(p.revenue)}
                  r={ranged}
                  tip="Gross top-line = conversions × AOV (VAT-inclusive). This is what ties to Meta / Google / Shopify — not money you keep, since VAT is remitted."
                />
                <Row
                  label="Net revenue (ex-VAT)"
                  pick={(p) => eur(p.netRevenue)}
                  r={ranged}
                  tip="The revenue you actually keep = Revenue ÷ (1 + VAT). This is the basis for all profit and break-even figures below."
                />
                <Row
                  label="Cost per sale (CPA)"
                  pick={(p) => eur(p.cpa)}
                  r={ranged}
                  tip="Cost per acquisition (CPA) = spend ÷ conversions — what you pay to win one customer (same as CAC here, since one order = one new customer). VAT-neutral. Compare against break-even CPA: above it, you lose money on the first sale."
                />
                <Row
                  label="Return on ad spend (ROAS)"
                  pick={(p) => ratio(p.roas)}
                  r={ranged}
                  tip="Revenue ÷ spend (on VAT-inclusive revenue) — €X back per €1 spent. This is the platform-attributed figure that matches Ads Manager, not incremental return, and it's a top-line efficiency ratio, NOT profit — use Profit / sale for that. Real incremental return is lower once attribution loss is accounted for."
                />
                <Row
                  label="Profit / sale (front-end)"
                  pick={(p) => eur(p.profitPerSale)}
                  r={ranged}
                  tip="Per-sale profit after VAT and all variable costs, on the first purchase only: (net AOV × contribution margin) − CPA. Negative means each sale loses money at this CPA."
                />
                <Row
                  label="Profit / sale (with LTV)"
                  pick={(p) => eur(p.profitPerSaleLtv)}
                  r={ranged}
                  tip="Profit / sale crediting repeat purchases: (net AOV × contribution margin × M) − CPA, where M is the LTV multiplier you set. Front-end + expected repeat value."
                />
                <Row
                  label="Total profit"
                  pick={(p) => eur(p.totalProfit)}
                  r={ranged}
                  emphasize
                  tip="Front-end net profit across all conversions = contribution (net AOV × contribution margin × conversions) − spend. After VAT and all variable per-order costs, before LTV."
                />
                <Row
                  label="Min daily budget (learning)"
                  pick={(p) => eur(p.minDailyBudget)}
                  r={ranged}
                  tip="The spend/day per ad set that would clear Meta's learning phase (~50 events / 7 days) AT THIS CPA: (50 ÷ 7) × CPA. This is a MECHANICAL figure, NOT a recommendation: when CPA is above break-even (the usual case here), every one of those conversions loses money, so spending this much would just lose money faster. Only meaningful once the CPA is profitable. The 'Recommended next step' above is the figure to act on."
                />
              </tbody>
            </table>
          </div>
          <div className="mt-4 grid grid-cols-2 sm:grid-cols-3 gap-4 text-sm">
            {/* Break-even CVR is a traffic-model concept (needs a click price);
                hide it in conversion-bid mode where it's not defined. */}
            {model !== "cps" && (
              <>
                <Callout
                  label="Break-even CVR"
                  value={pct(ranged.expected.breakEvenCvr)}
                  hint="Click CVR where front-end profit = 0: effective CPC ÷ (net AOV × contribution margin), with net AOV = AOV ÷ (1 + VAT). Your measured CVR must clear this to be profitable."
                />
                <Callout
                  label="Break-even CVR (with LTV)"
                  value={pct(ranged.expected.breakEvenCvrLtv)}
                  hint="The same break-even CVR but crediting repeat purchases (÷ the LTV multiplier M) — a lower bar once you count lifetime value."
                />
              </>
            )}
            <Callout
              label="Break-even CPA"
              value={eur(ranged.expected.breakEvenCpa)}
              hint="Contribution per sale = net AOV × contribution margin (after VAT and all variable costs). Pay more than this per acquisition and you lose money on the first sale. In conversion-bid mode, keep your target CPA below this line."
            />
          </div>
          <p className="mt-4 text-[11px]" style={{ color: "var(--text-secondary)" }}>
            Linear model — returns are projected at a constant rate. At higher
            daily budgets real returns taper (auction saturation, frequency / CPM
            creep, creative fatigue), so treat large-budget projections as
            optimistic. The figures also assume fresh creative and exclude
            attribution loss (platform-reported, not incremental).
          </p>
        </Collapsible>
      )}

      {/* What this spend buys + whether you can test on it. Collapsed by default —
          a deeper planning question; most sessions want verdict → inputs → done. */}
      {forecast && (
        <Collapsible
          title="What this spend buys"
          defaultOpen={false}
          tip="The real traffic and conversions a daily budget buys — and, crucially, whether that's enough to A/B test. Ad spend buys site visitors even in conversion-bid mode (you're just billed per sale), and not all of them convert. Visitors decide whether on-site tests can reach significance; conversions decide whether you can test the purchase rate itself."
        >
          {/* Editable planning budget — set what you're considering spending. */}
          <div className="mb-4 max-w-xs">
            <TextField
              label="Forecast at (€/day)"
              value={forecastBudgetOverride}
              onChange={setForecastBudgetOverride}
              placeholder={`${Math.round(forecast.dailyBudget)} (${forecastBudgetOverride.trim() ? "your figure" : leverage?.recommendation.action === "spend" ? "recommended" : "budget ÷ 30"})`}
              tip="The daily spend to model traffic for — a planning knob, separate from the campaign budget above. Leave blank to use the recommended safe daily spend (when there is one) or your campaign budget ÷ 30. Type a figure to see what a specific daily spend would buy."
            />
          </div>

          {/* Two plain numbers: visitors (the site-test denominator) + conversions. */}
          <div className="grid grid-cols-2 gap-4 text-sm mb-4">
            <div className="rounded-lg p-3" style={{ background: "var(--bg-primary)" }}>
              <div className="text-xs inline-flex items-center gap-1" style={{ color: "var(--text-secondary)" }}>
                Site visitors
                <InfoTooltip text="People your ad spend sends to the site = daily budget ÷ cost-per-click. This happens in every mode, including conversion-bid — you're billed per sale, but the clicks (and visitors) are real. Not all convert; this is the pool an on-site A/B test draws from." label="What are site visitors?" />
              </div>
              <div className="text-lg font-semibold">
                {forecast.visitorsPerDay === undefined ? "—" : `${int(forecast.visitorsPerDay)}/day`}
              </div>
              <div className="text-[11px]" style={{ color: "var(--text-secondary)" }}>
                {forecast.visitorsPerWeek === undefined ? "" : `${int(forecast.visitorsPerWeek)}/wk · ${int(forecast.visitorsPerMonth)}/mo`}
              </div>
            </div>
            <div className="rounded-lg p-3" style={{ background: "var(--bg-primary)" }}>
              <div className="text-xs inline-flex items-center gap-1" style={{ color: "var(--text-secondary)" }}>
                Sales (conversions)
                <InfoTooltip text="Purchases the spend produces per day. Drives both Meta's optimisation (≥~50/ad set/week to exit Learning) and whether you can read a purchase-rate result. At a low conversion rate these trickle in." label="What are conversions?" />
              </div>
              <div className="text-lg font-semibold">
                {forecast.conversionsPerDay === undefined ? "—" : `${forecast.conversionsPerDay.toFixed(1)}/day`}
              </div>
              <div className="text-[11px]" style={{ color: "var(--text-secondary)" }}>
                {forecast.conversionsPerWeek === undefined ? "" : `${forecast.conversionsPerWeek.toFixed(1)}/wk · ${forecast.conversionsPerMonth?.toFixed(0)}/mo`}
              </div>
            </div>
          </div>

          {/* The decision: can you actually test at this spend? */}
          <div className="text-xs font-medium mb-2" style={{ color: "var(--text-secondary)" }}>
            Can you A/B test at this spend?
          </div>
          <div className="space-y-1.5">
            <TestRow
              label="On-site test"
              sub="e.g. a PDP or checkout change — judged on add-to-cart"
              days={forecast.siteTestDays}
            />
            <TestRow
              label="Purchase-rate test"
              sub="testing whether a change moves actual sales"
              days={forecast.conversionTestDays}
            />
          </div>
          {/* Meta's learning phase is a separate question (the algorithm, not a test). */}
          <div className="mt-3 text-[11px] flex items-center gap-1.5" style={{ color: "var(--text-secondary)" }}>
            <span>
              Meta needs ~50 sales/ad set/week to exit its learning phase —{" "}
              <strong>
                {forecast.daysToLearningPhase === undefined
                  ? "not reachable at this spend"
                  : `about ${humanDuration(forecast.daysToLearningPhase)} here`}
              </strong>
              .
            </span>
            <InfoTooltip text="Below ~50 conversions per ad set per 7 days, Meta's delivery stays 'Learning Limited' and under-optimises. This is about the algorithm getting enough signal, separate from whether YOU can read an A/B result." label="What is the learning phase?" />
          </div>
          <p className="mt-2 text-[11px]" style={{ color: "var(--text-secondary)" }}>
            A/B durations target a 20% relative lift at 95% confidence and scale linearly from
            one day (no saturation/fatigue modelling), so large-budget figures are optimistic.
            A test that takes many months isn&apos;t worth running — at this traffic you can
            usually only test the higher-up funnel (add-to-cart), not the purchase rate itself,
            until conversion rate or budget rises.
          </p>
        </Collapsible>
      )}

      {/* Candidate content — same section-header treatment (brand dot + primary
          title) as the other cards, so it reads as a peer section not an aside. */}
      <div className="rounded-xl p-5" style={card}>
        <div className="flex items-start justify-between gap-3 mb-1 flex-wrap">
          <h3 className="text-base font-medium inline-flex items-center gap-2" style={{ color: "var(--text-primary, var(--text-secondary))" }}>
            <span className="inline-block w-1 h-4 rounded-full" style={{ background: "var(--brand)" }} />
            Best posts to promote
          </h3>
          <div className="flex items-center gap-2 text-xs">
            <span style={{ color: "var(--text-secondary)" }}>Rank by</span>
            <div className="flex gap-1">
              {(
                [
                  [
                    "viralityIndex",
                    "Save + share rate",
                    "Saves + shares per 1,000 people reached, weighted by reach confidence and recency. One honest denominator across platforms, so it's the best cross-platform pick: it asks 'of the people who saw this, how many wanted to keep it or pass it on?' — the intent that survives the jump from organic feed to paid placement.",
                  ],
                  [
                    "intentScore",
                    "Engagement quality",
                    "A 0–100 score of active-intent engagement (comment / save / outbound-click rates) measured against each platform's own benchmarks. 80 = strong FOR THAT PLATFORM, 50 = on par with norms. Best for judging engagement depth within one platform; it is platform-relative, so don't read it as an absolute cross-platform magnitude — use save + share rate for that.",
                  ],
                ] as [CandidateSortKey, string, string][]
              ).map(([key, label, tip]) => (
                <button
                  key={key}
                  onClick={() => setCandidateSort(key)}
                  title={tip}
                  className="px-2 py-0.5 rounded transition-colors cursor-pointer"
                  style={{
                    background: candidateSort === key ? "var(--brand)" : "transparent",
                    color: candidateSort === key ? "#fff" : "var(--text-secondary)",
                    border: "1px solid var(--border)",
                  }}
                >
                  {label}
                </button>
              ))}
            </div>
            <InfoTooltip
              text="Two ways to rank organic posts as paid creative. Save + share rate = (saves + shares) ÷ reach, shown per 1,000 reach — the cross-platform-honest measure of intent to keep or share. Engagement quality = a 0–100 composite of comment/save/click rates vs each platform's benchmarks — engagement depth, but platform-relative. Both are weighted by reach confidence (so a fluke on tiny reach can't top the list) and recency (fresh creative outranks stale of equal rate)."
              label="Which ranking should I use?"
            />
          </div>
        </div>
        <p className="text-xs mb-4" style={{ color: "var(--text-secondary)" }}>
          Your existing organic posts, ranked by how well they&apos;d likely work as paid
          ads. Each row shows the score, a plain read on why it qualifies, and the
          reach / saves+shares behind it. Click a thumbnail to open the post.
          {candidateSort === "viralityIndex" ? (
            <> Score = saves + shares per 1,000 reach; the secondary <strong>/like</strong>{" "}
            figure rides along per row for context.</>
          ) : (
            <> Score = engagement quality, 0–100 vs the post&apos;s platform benchmarks.</>
          )}
        </p>
        {candidates.length === 0 ? (
          <p className="text-sm" style={{ color: "var(--text-secondary)" }}>
            No scoreable candidates in the current data.
          </p>
        ) : (
          <div className="space-y-2">
            {candidates.map((c, i) => {
              // Use the platform-native post id (pinterest_<id> etc.), NOT the
              // Airtable record id in c.postId, or Pinterest links resolve to the
              // product page instead of the pin.
              const url = resolveViewUrl(c.platform, c.post.nativePostId, c.post.mediaUrl);
              // Virality /reach is a tiny decimal (e.g. 0.012); render it as
              // "saves + shares per 1,000 reach" so the number is legible.
              const score =
                candidateSort === "viralityIndex"
                  ? c.viralityIndex !== undefined
                    ? (c.viralityIndex * 1000).toFixed(1)
                    : undefined
                  : c.intentScore?.toFixed(1);
              const scoreUnit =
                candidateSort === "viralityIndex" ? "per 1k reach" : "quality /100";
              const reasons = candidateRationale(c);
              return (
                <a
                  key={c.postId}
                  href={url || undefined}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex items-center gap-3 rounded-lg p-2 transition-colors hover:bg-white/5"
                  style={{ border: "1px solid var(--border)" }}
                  title={`View on ${getPlatformConfig(c.platform).label}`}
                >
                  <span
                    className="shrink-0 w-6 text-center text-xs font-semibold"
                    style={{ color: "var(--text-secondary)" }}
                  >
                    {i + 1}
                  </span>
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={c.post.mediaUrl || ""}
                    alt=""
                    className="shrink-0 w-12 h-12 rounded object-cover"
                    style={{ background: "var(--bg-primary)" }}
                    onError={(e) => {
                      (e.currentTarget as HTMLImageElement).style.visibility = "hidden";
                    }}
                  />
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2 text-xs" style={{ color: "var(--text-secondary)" }}>
                      <span
                        className="inline-block w-1.5 h-1.5 rounded-full"
                        style={{ background: getPlatformConfig(c.platform).color }}
                      />
                      <span className="capitalize">{c.platform}</span>
                      {c.post.postType && <span>· {c.post.postType}</span>}
                      {c.post.publishedAt && <span>· {c.post.publishedAt.slice(0, 10)}</span>}
                    </div>
                    <div className="text-sm truncate" title={c.post.caption?.trim() || undefined}>
                      {c.post.caption?.trim() || "(no caption)"}
                    </div>
                    {/* Plain-language "why this is a candidate", from the breakdown. */}
                    <div className="text-[11px] mt-0.5" style={{ color: "var(--text-secondary)" }}>
                      {reasons.join(" · ")}
                    </div>
                  </div>
                  <div className="shrink-0 text-right">
                    <div className="text-sm font-semibold tabular-nums">{score ?? "—"}</div>
                    <div className="text-[10px]" style={{ color: "var(--text-secondary)" }}>
                      {scoreUnit}
                    </div>
                    <div className="text-[11px] mt-0.5" style={{ color: "var(--text-secondary)" }}>
                      {int(c.breakdown.reach)} reach · {c.breakdown.saves + c.breakdown.shares} s+s
                    </div>
                    {/* Secondary /likes readout — kept for context, no longer a sort. */}
                    {c.viralityIndexByLikes !== undefined && (
                      <div className="text-[10px]" style={{ color: "var(--text-secondary)" }}>
                        {c.viralityIndexByLikes.toFixed(2)} /like
                      </div>
                    )}
                  </div>
                </a>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}

