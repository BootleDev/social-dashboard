"use client";

import { useEffect, useMemo, useState } from "react";
import type { DailyAdRow, ShopifySalesRow } from "@/lib/adBaseline";
import { resolveScenario, simulate, type ScenarioOverrides } from "@/lib/adSimulate";
import { forecastTraffic } from "@/lib/adEconomics";
import { analyzeLeverage } from "@/lib/adLeverage";
import {
  DEFAULT_VAT_RATE,
  PROVISIONAL_SESSION_CVR,
  PROVISIONAL_CVR_AS_OF,
  type Baseline,
  type EstimateWithConfidence,
  type PricingModel,
} from "@/lib/adScenario";
import { rankCandidates, type CandidateSortKey } from "@/lib/adCandidate";
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
  // Target CPA (€) for the conversion-bid model. Empty = use baseline-implied.
  const [targetCpaOverride, setTargetCpaOverride] = usePersistedState("paid_targetCpa", "");
  const [grossMarginPct, setGrossMarginPct] = usePersistedState("paid_grossMarginPct", 65);
  const [vatRatePct, setVatRatePct] = usePersistedState("paid_vatRatePct", DEFAULT_VAT_RATE * 100);
  const [ltvMultiplier, setLtvMultiplier] = usePersistedState("paid_ltv", 1.0);
  // Optional manual overrides (empty string = use the baseline value). CVR / CTR
  // overrides are in PERCENT (e.g. "2" = 2%); cpc/cpm/aov are euros.
  const [cvrOverride, setCvrOverride] = usePersistedState("paid_cvr", "");
  const [ctrOverride, setCtrOverride] = usePersistedState("paid_ctr", "");
  const [cpcOverride, setCpcOverride] = usePersistedState("paid_cpc", "");
  const [cpmOverride, setCpmOverride] = usePersistedState("paid_cpm", "");
  const [aovOverride, setAovOverride] = usePersistedState("paid_aov", "");

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

  // Bidirectional CPA↔CVR for conversion-bid mode: typing a Target CPA fills the
  // CVR field with the rate that target REQUIRES (CPC ÷ CPA), so inputs and
  // outputs stay consistent — you're explicitly modeling the funnel that hits
  // your target. "Reset to actuals" clears both back to live data. (The reverse,
  // CVR → achievable CPA placeholder, already happens in the sim useMemo.)
  const onTargetCpaChange = (next: string) => {
    setTargetCpaOverride(next);
    const cpa = Number(next);
    const cpc = baseline?.cpc.value;
    if (next.trim() !== "" && Number.isFinite(cpa) && cpa > 0 && cpc !== undefined) {
      const requiredCvrPct = (cpc / cpa) * 100; // percent, matching the CVR field unit
      setCvrOverride(requiredCvrPct.toFixed(2));
    } else if (next.trim() === "") {
      // Clearing the CPA returns CVR to live-driven (empty = provisional default).
      setCvrOverride("");
    }
  };

  // Reset every scenario lever back to live/measured actuals.
  const resetToActuals = () => {
    setTargetCpaOverride("");
    setCvrOverride("");
    setAovOverride("");
    setCpcOverride("");
    setCpmOverride("");
    setCtrOverride("");
  };

  // Whether the user has diverged from live actuals (enables the reset button).
  const hasOverrides =
    [targetCpaOverride, cvrOverride, aovOverride, cpcOverride, cpmOverride, ctrOverride].some(
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

    // CPS needs a target CPA. When the user hasn't typed one, seed it from the
    // ACHIEVABLE CPA the funnel delivers at the effective CVR (CPC ÷ CVR) — so
    // the DEFAULT projection models reality (real, usually-negative profit) and
    // the verdict / levers / projection all agree. Break-even CPA is the line to
    // beat (shown separately), NOT what we model by default. A user-typed target
    // overrides this to explore a hypothetical.
    const achievableCpaSeed =
      baseline.cpc.value !== undefined && effectiveCvr > 0
        ? baseline.cpc.value / effectiveCvr
        : undefined;
    const targetCpa =
      model === "cps"
        ? num(targetCpaOverride) ?? achievableCpaSeed
        : undefined;

    const overrides: ScenarioOverrides = {
      model,
      budget,
      targetCpa,
      grossMargin: grossMarginPct / 100,
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
      const lev = analyzeLeverage(scenario, { achievableCpa });
      const expected = simulate(scenario, { baseline });
      // Forecast traffic + time-to-learning at a sensible DAILY budget: the
      // recommended daily spend if there is one, else the learning-phase floor,
      // else budget/30. Tells the operator whether they'll get enough volume to
      // learn (their A/B / data question) before committing.
      const dailyBudget =
        lev.recommendation.dailyBudget ??
        expected.expected.minDailyBudget ??
        budget / 30;
      return {
        ranged: expected,
        leverage: lev,
        forecast: forecastTraffic(scenario, dailyBudget),
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
  }, [baseline, api, model, budget, targetCpaOverride, grossMarginPct, vatRatePct, ltvMultiplier, cvrOverride, ctrOverride, cpcOverride, cpmOverride, aovOverride]);

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
  //  - break-even CPA (net AOV × gross margin): the most you can pay per sale.
  //  - achievable CPA (CPC ÷ effective CVR): what the funnel forces per sale now.
  // The gap between them is the conversion problem.
  const breakEvenCpaDisplay =
    effectiveAovDisplay !== undefined
      ? (effectiveAovDisplay / (1 + vatRatePct / 100)) * (grossMarginPct / 100)
      : undefined;
  const impliedBaselineCpa =
    baseline?.cpc.value !== undefined && effectiveCvrDisplay > 0
      ? baseline.cpc.value / effectiveCvrDisplay
      : undefined;
  // Reverse lookup: when a Target CPA is pinned, the CVR the funnel must hit to
  // deliver it (achievable CPA = CPC ÷ CVR ⇒ requiredCvr = CPC ÷ targetCPA).
  const pinnedTargetCpa =
    targetCpaOverride.trim() !== "" && Number.isFinite(Number(targetCpaOverride))
      ? Number(targetCpaOverride)
      : undefined;
  const requiredCvrForTarget =
    pinnedTargetCpa !== undefined && pinnedTargetCpa > 0 && baseline?.cpc.value !== undefined
      ? baseline.cpc.value / pinnedTargetCpa
      : undefined;
  // How far that required CVR is from the current/provisional CVR.
  const requiredCvrMultiple =
    requiredCvrForTarget !== undefined && effectiveCvrDisplay > 0
      ? requiredCvrForTarget / effectiveCvrDisplay
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
        `- Inputs: conversion rate ${pct(effectiveCvrDisplay)} (${cvrOverride.trim() ? "user override" : "provisional Shopify, all-traffic"}), AOV ${eur(effectiveAovDisplay)} (fresh Shopify), gross margin ${grossMarginPct}% (on net), VAT ${vatRatePct}%.`,
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
    effectiveCvrDisplay, effectiveAovDisplay, grossMarginPct, vatRatePct,
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

      {/* 1. Measured baseline — supporting evidence, collapsed by default. */}
      {baseline && (
        <Collapsible
          title="Measured baseline"
          defaultOpen={false}
          tip={`Pooled from real ad history, ${api?.window.start} → ${api?.window.end}. The conversion funnel (CVR + AOV) is ad-attributed and same-source. AOV is gross (incl. VAT); revenue and ROAS stay gross, while profit and break-even use net = AOV ÷ (1 + VAT) at the VAT rate and gross margin you set.`}
        >
          <div className="grid grid-cols-2 sm:grid-cols-5 gap-4">
            <Metric
              label="CPC"
              value={eur(baseline.cpc.value)}
              conf={baseline.cpc.confidence}
              tip="Cost per click, pooled (total spend ÷ total clicks) over the window — the volume-weighted price actually paid, not a mean of daily rates. VAT-neutral."
            />
            <Metric
              label="CTR"
              value={pct(baseline.ctr.value)}
              conf={baseline.ctr.confidence}
              tip="Click-through rate, pooled (total clicks ÷ total impressions). Drives the CPM model's click count."
            />
            <Metric
              label="Click CVR"
              value={pct(baseline.clickCvr.value)}
              conf={baseline.clickCvr.confidence}
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
              tip="Average order value, GROSS (what the customer paid, VAT included) — from Meta's ad-attributed purchase value. Revenue/ROAS use this gross figure; profit/break-even use net = AOV ÷ (1 + VAT). 'store-wide' is the whole-store Shopify basket, shown for comparison only."
              sub={`store-wide ${eur(baseline.shopifyAov.value)}`}
            />
            <Metric
              label="CPM"
              value={eur(baseline.cpm.value)}
              conf={baseline.cpm.confidence}
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

      {/* 2. Scenario inputs — collapsible, open by default. */}
      <Collapsible
        title="Scenario — adjust the model"
        tip="Rates are entered as percents (margin 65, VAT 20, CVR 2); money fields are euros. Overrides left blank fall back to the measured baseline. Default mode is conversion-bid — how Meta is actually bought in 2026: you set a budget and a target CPA, and CPM/CPC/CTR are auction outcomes."
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
          <button
            type="button"
            onClick={resetToActuals}
            disabled={!hasOverrides}
            className="text-xs px-2.5 py-1 rounded transition-colors shrink-0"
            style={{
              background: hasOverrides ? "var(--bg-secondary)" : "transparent",
              color: hasOverrides ? "var(--text-primary, var(--text-secondary))" : "var(--text-secondary)",
              border: "1px solid var(--border)",
              cursor: hasOverrides ? "pointer" : "default",
              opacity: hasOverrides ? 1 : 0.5,
            }}
            title="Clear all overrides and return every input to live / measured data"
          >
            ↺ Reset to actuals
          </button>
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
                <TextField
                  label="Target CPA (€)"
                  value={targetCpaOverride}
                  onChange={onTargetCpaChange}
                  placeholder={`${eur(impliedBaselineCpa)} (CVR-driven)`}
                  tip="The cost cap / target CPA you'd set on Meta (€). Conversions = budget ÷ target CPA. Type one and the conversion rate it REQUIRES (CPC ÷ target CPA) fills the CVR field automatically — inputs and outputs stay consistent. Leave blank to let CVR drive the achievable CPA instead. 'Reset to actuals' returns both to live data."
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

          {/* GROUP 2: properties of your funnel + economics. */}
          <div>
            <div className="text-[11px] font-semibold uppercase tracking-wide mb-2" style={{ color: "var(--text-secondary)" }}>
              Your funnel &amp; economics
            </div>
            <div className="grid grid-cols-2 gap-4">
              <TextField
                label="Conversion rate (%)"
                value={cvrOverride}
                onChange={setCvrOverride}
                placeholder={pctPlain(PROVISIONAL_SESSION_CVR)}
                tip={`Session→purchase conversion rate, in percent. Defaults to ${pct(PROVISIONAL_SESSION_CVR)} — Shopify's all-traffic storefront funnel over the trailing 90 days (to ${PROVISIONAL_CVR_AS_OF}), provisional until live GA4 attribution lands. Drives the achievable CPA (CPC ÷ CVR). Auto-fills when you set a Target CPA so inputs match outputs. The verdict's reality check always compares against your live MEASURED rate, not this field — so an optimistic CVR here won't hide that the funnel can't deliver it. 'Reset to actuals' clears it.`}
              />
              <TextField
                label="AOV (€)"
                value={aovOverride}
                onChange={setAovOverride}
                placeholder={eur(api?.freshShopifyAov?.value ?? baseline?.aov.value)}
                tip="Average order value (€), GROSS / incl. VAT. Defaults to the fresh, comp-excluded Shopify store AOV (current, runs past the stale ad window). Net is derived via the VAT rate. Override to model a different basket."
              />
              <NumField
                label="Gross margin (%)"
                value={grossMarginPct}
                onChange={setGrossMarginPct}
                step={1}
                min={0}
                max={100}
                tip="Gross profit as a percent of NET (ex-VAT) revenue — the standard COGS margin (enter 65 for 65%). Applied to net AOV, not gross, so VAT is never counted as profit."
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
        </div>

        {/* Live cause→effect readout. The TOP LINE flips direction by mode so
            there's never two CVR figures competing: CVR-driven shows
            CVR→achievable CPA; pinned shows target CPA→required CVR. */}
        {model === "cps" && (
          <div
            className="mt-4 rounded-lg p-3 text-xs flex flex-wrap items-center gap-x-2 gap-y-1"
            style={{ background: "var(--bg-primary)", color: "var(--text-secondary)" }}
          >
            {pinnedTargetCpa === undefined ? (
              <>
                <span>
                  Conversion rate <strong>{pct(effectiveCvrDisplay)}</strong>
                </span>
                <span aria-hidden>→</span>
                <span>
                  achievable CPA <strong>{eur(impliedBaselineCpa)}</strong>
                  <span className="opacity-70"> (CPC {eur(baseline?.cpc.value)} ÷ CVR)</span>
                </span>
              </>
            ) : (
              <>
                <span>
                  Target CPA <strong>€{pinnedTargetCpa.toFixed(2)}</strong>
                </span>
                <span aria-hidden>→</span>
                <span>
                  needs conversion rate <strong>{pct(requiredCvrForTarget)}</strong>
                  <span className="opacity-70"> (CPC {eur(baseline?.cpc.value)} ÷ target CPA)</span>
                </span>
              </>
            )}
            <span aria-hidden>·</span>
            <span>
              break-even CPA <strong>{eur(breakEvenCpaDisplay)}</strong>
            </span>
            <span className="basis-full" />
            {pinnedTargetCpa === undefined ? (
              <span>
                The projection uses the <strong>achievable</strong> CPA, so moving conversion
                rate moves the result. Raise CVR until achievable drops below break-even to
                turn a profit. Type a Target CPA to pin one and see the CVR it requires.
              </span>
            ) : (
              <span>
                To hit this CPA your funnel must convert at{" "}
                <strong>{pct(requiredCvrForTarget)}</strong>
                {requiredCvrMultiple !== undefined && (
                  <>
                    {" — "}
                    {requiredCvrMultiple > 1.05
                      ? `~${requiredCvrMultiple.toFixed(1)}× your current ${pct(effectiveCvrDisplay)}`
                      : requiredCvrMultiple < 0.95
                        ? `below your current ${pct(effectiveCvrDisplay)}, comfortably reachable`
                        : `about your current ${pct(effectiveCvrDisplay)}`}
                  </>
                )}
                . Your set conversion rate ({pct(effectiveCvrDisplay)}) is unchanged — it&apos;s
                only used here to show the gap. Clear the field to go back to the live
                CVR-driven CPA.
              </span>
            )}
          </div>
        )}
      </Collapsible>

      {/* 2. DECISION — the verdict reads off the scenario you just set above. */}
      {leverage && <LeveragePanel report={leverage} />}

      {/* 3. Projection — collapsible, open by default. */}
      {ranged && (
        <div className="rounded-xl p-5" style={card}>
          <div className="flex items-baseline justify-between mb-4">
            <h3 className="text-base font-medium inline-flex items-center gap-2" style={{ color: "var(--text-primary, var(--text-secondary))" }}>
              <span className="inline-block w-1 h-4 rounded-full" style={{ background: "var(--brand)" }} />
              Projection — €{budget} on {MODEL_LABEL[model]}
            </h3>
            {ranged.flags.lowConfidence && (
              <span className="text-[11px]" style={{ color: "var(--text-secondary)" }}>
                low-confidence baseline · treat as directional
              </span>
            )}
          </div>
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
                  label="CPA / CAC"
                  pick={(p) => eur(p.cpa)}
                  r={ranged}
                  tip="Cost per acquisition = spend ÷ conversions. Same as customer acquisition cost (CAC) here, since the model treats one order as one new customer. VAT-neutral. Compare against Break-even CPA: above it, you lose money on the first sale."
                />
                <Row
                  label="Attributed ROAS"
                  pick={(p) => ratio(p.roas)}
                  r={ranged}
                  tip="Return on ad spend = gross Revenue ÷ spend, on VAT-inclusive revenue. This is PLATFORM-ATTRIBUTED ROAS on modeled conversions (matches Ads Manager) — NOT incremental and NOT blended MER. A top-line efficiency ratio, not a profit measure — use Profit / sale for that. Real incremental return is lower once attribution loss is accounted for."
                />
                <Row
                  label="Profit / sale (front-end)"
                  pick={(p) => eur(p.profitPerSale)}
                  r={ranged}
                  tip="Per-sale profit after VAT and COGS, on the first purchase only: (net AOV × gross margin) − CPA. Negative means each sale loses money at this CPA."
                />
                <Row
                  label="Profit / sale (with LTV)"
                  pick={(p) => eur(p.profitPerSaleLtv)}
                  r={ranged}
                  tip="Profit / sale crediting repeat purchases: (net AOV × gross margin × M) − CPA, where M is the LTV multiplier you set. Front-end + expected repeat value."
                />
                <Row
                  label="Total profit"
                  pick={(p) => eur(p.totalProfit)}
                  r={ranged}
                  emphasize
                  tip="Front-end net profit across all conversions = gross profit (on net revenue) − spend. After VAT and COGS, before LTV."
                />
                <Row
                  label="Min daily budget (learning)"
                  pick={(p) => eur(p.minDailyBudget)}
                  r={ranged}
                  tip="Spend/day per ad set needed to clear Meta's learning phase (~50 optimization events / 7 days) at this CPA: (50 ÷ 7) × CPA. Below this the ad set stays 'Learning Limited'."
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
                  hint="Click CVR where front-end profit = 0: effective CPC ÷ (net AOV × gross margin), with net AOV = AOV ÷ (1 + VAT). Your measured CVR must clear this to be profitable."
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
              hint="Contribution per sale = net AOV × gross margin (after VAT and COGS). Pay more than this per acquisition and you lose money on the first sale. In conversion-bid mode, keep your target CPA below this line."
            />
          </div>
          <p className="mt-4 text-[11px]" style={{ color: "var(--text-secondary)" }}>
            Linear model — returns are projected at a constant rate. At higher
            daily budgets real returns taper (auction saturation, frequency / CPM
            creep, creative fatigue), so treat large-budget projections as
            optimistic. The figures also assume fresh creative and exclude
            attribution loss (platform-reported, not incremental).
          </p>
        </div>
      )}

      {/* Traffic + time-to-learning forecast — "will I get enough data?" */}
      {forecast && (
        <Collapsible
          title="Traffic & time to learn"
          tip="Volume the recommended daily budget buys, and how long until you have enough conversions to optimise / trust a result. At a low conversion rate, conversions trickle in — so reaching a learnable sample can take weeks. Use these counts to judge whether a test or a real read is feasible before committing spend."
        >
          <p className="text-xs mb-3" style={{ color: "var(--text-secondary)" }}>
            At <strong>{eur(forecast.dailyBudget)}/day</strong> (the recommended daily spend).
          </p>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 text-sm">
            <Metric
              label="Sessions / day"
              value={int(forecast.sessionsPerDay)}
              conf="ok"
              sub={`${int(forecast.sessionsPerWeek)}/wk · ${int(forecast.sessionsPerMonth)}/mo`}
              tip="Engaged sessions the daily budget buys (clicks that don't bounce). Conversion-bid mode has no traffic stage, so this is blank there — use a diagnostic CPC/CPM mode to forecast clicks."
            />
            <Metric
              label="Conversions / day"
              value={forecast.conversionsPerDay === undefined ? "—" : forecast.conversionsPerDay.toFixed(1)}
              conf="ok"
              sub={`${forecast.conversionsPerWeek?.toFixed(1) ?? "—"}/wk · ${forecast.conversionsPerMonth?.toFixed(0) ?? "—"}/mo`}
              tip="Projected purchases per day at this spend. This is the signal that drives both Meta's optimisation and your ability to read a result."
            />
            <Metric
              label="Days to exit learning"
              value={forecast.daysToLearningPhase === undefined ? "— (too few)" : `~${Math.ceil(forecast.daysToLearningPhase)}d`}
              conf="ok"
              tip="Days to accumulate ~50 conversions per ad set — Meta's learning-phase threshold, where the algorithm has enough signal to optimise. Far out (or '—') means this daily budget is too thin to ever stabilise."
            />
            <Metric
              label="Days to readable sample"
              value={forecast.daysToReadableSample === undefined ? "— (too few)" : `~${Math.ceil(forecast.daysToReadableSample)}d`}
              conf="ok"
              tip="Days to ~150 conversions — a looser bar for trusting the measured rate (e.g. before judging a change). At a ~0.2% funnel on a small budget this is often many weeks; that's your answer on whether testing is practical yet."
            />
          </div>
          <p className="mt-3 text-[11px]" style={{ color: "var(--text-secondary)" }}>
            Counts scale linearly from a one-day run, so weekly/monthly figures don&apos;t
            account for saturation or fatigue at higher spend. If &ldquo;days to readable
            sample&rdquo; is many weeks, you likely won&apos;t have the data to test
            variations meaningfully until conversion rate rises.
          </p>
        </Collapsible>
      )}

      {/* Candidate content */}
      <div className="rounded-xl p-5" style={card}>
        <div className="flex items-start justify-between gap-3 mb-1 flex-wrap">
          <h3 className="text-base font-medium" style={{ color: "var(--text-secondary)" }}>
            Ad-candidate content
          </h3>
          <div className="flex gap-1 text-xs">
            {(
              [
                ["viralityIndex", "Virality /reach"],
                ["viralityIndexByLikes", "/likes"],
                ["intentScore", "Intent score"],
              ] as [CandidateSortKey, string][]
            ).map(([key, label]) => (
              <button
                key={key}
                onClick={() => setCandidateSort(key)}
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
        </div>
        <p className="text-xs mb-4" style={{ color: "var(--text-secondary)" }}>
          Top existing organic posts as paid-creative candidates, ranked by the
          selected signal and volume-weighted. Click a thumbnail to open the post.
        </p>
        {candidates.length === 0 ? (
          <p className="text-sm" style={{ color: "var(--text-secondary)" }}>
            No scoreable candidates in the current data.
          </p>
        ) : (
          <div className="space-y-2">
            {candidates.map((c, i) => {
              const url = resolveViewUrl(c.platform, c.postId, c.post.mediaUrl);
              const score =
                candidateSort === "viralityIndex"
                  ? c.viralityIndex?.toFixed(4)
                  : candidateSort === "viralityIndexByLikes"
                    ? c.viralityIndexByLikes?.toFixed(3)
                    : c.intentScore?.toFixed(1);
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
                  </div>
                  <div className="shrink-0 text-right">
                    <div className="text-sm font-semibold">{score ?? "—"}</div>
                    <div className="text-[11px]" style={{ color: "var(--text-secondary)" }}>
                      {int(c.breakdown.reach)} reach · {c.breakdown.saves + c.breakdown.shares} s+s
                    </div>
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

