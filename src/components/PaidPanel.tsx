"use client";

import { useEffect, useMemo, useState } from "react";
import type { DailyAdRow, ShopifySalesRow } from "@/lib/adBaseline";
import { resolveScenario, simulate, type ScenarioOverrides } from "@/lib/adSimulate";
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
  const [model, setModel] = useState<PricingModel>("cps");
  const [budget, setBudget] = useState(500);
  // Target CPA (€) for the conversion-bid model. Empty = use baseline-implied.
  const [targetCpaOverride, setTargetCpaOverride] = useState("");
  const [grossMarginPct, setGrossMarginPct] = useState(65);
  const [vatRatePct, setVatRatePct] = useState(DEFAULT_VAT_RATE * 100);
  const [ltvMultiplier, setLtvMultiplier] = useState(1.0);
  // Optional manual overrides (empty string = use the baseline value). CVR / CTR
  // overrides are in PERCENT (e.g. "2" = 2%); cpc/cpm/aov are euros.
  const [cvrOverride, setCvrOverride] = useState("");
  const [ctrOverride, setCtrOverride] = useState("");
  const [cpcOverride, setCpcOverride] = useState("");
  const [cpmOverride, setCpmOverride] = useState("");
  const [aovOverride, setAovOverride] = useState("");

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

  // Run the simulation whenever inputs change. Errors (e.g. missing baseline
  // input with no override) are surfaced, not thrown into render.
  const { ranged, leverage, simError } = useMemo(() => {
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
    // The CPA the funnel can actually deliver at the effective CVR — the
    // achievability gate for conversion-bid mode. Same basis as the seed.
    const achievableCpa = achievableCpaSeed;
    try {
      const scenario = resolveScenario(baseline, overrides);
      return {
        ranged: simulate(scenario, { baseline }),
        leverage: analyzeLeverage(scenario, { achievableCpa }),
        simError: null,
      };
    } catch (e) {
      return {
        ranged: null,
        leverage: null,
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

  // Staleness: how old is the latest active ad spend? Shopify is fresh, but the
  // ad price (CPC/CPM/CTR) baseline comes from possibly-months-old spend.
  const latestSpendDate = baseline?.flags.latestSpendDate;
  const spendAgeDays =
    latestSpendDate !== undefined
      ? Math.round((Date.now() - Date.parse(`${latestSpendDate}T00:00:00Z`)) / 86_400_000)
      : undefined;
  const spendIsStale = spendAgeDays !== undefined && spendAgeDays > 30;

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
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
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
          <NumField
            label="Budget (€)"
            value={budget}
            onChange={setBudget}
            step={50}
            min={0}
            tip="Total ad spend to model. Assumes full delivery (spend = budget)."
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
            label="LTV multiplier (M)"
            value={ltvMultiplier}
            onChange={setLtvMultiplier}
            step={0.05}
            min={1}
            tip="Repeat-value multiplier on gross profit, M = 1 + repeat rate (1.0 = no repeat). Captures backend / accessory sales on the modular product. Only affects the '(with LTV)' figures."
          />
          {model === "cps" && (
            <TextField
              label="Target CPA (€)"
              value={targetCpaOverride}
              onChange={setTargetCpaOverride}
              placeholder={eur(impliedBaselineCpa)}
              tip="The cost cap / target CPA you'd set on Meta (€). Conversions = budget ÷ target CPA. Blank = model the CPA your funnel can ACTUALLY deliver today (CPC ÷ conversion rate) so the projection is realistic. Type a number to explore a hypothetical (e.g. your break-even CPA below). Above the break-even line, every sale loses money."
            />
          )}
          <TextField
            label="Conversion rate (%)"
            value={cvrOverride}
            onChange={setCvrOverride}
            placeholder={pctPlain(PROVISIONAL_SESSION_CVR)}
            tip={`Session→purchase conversion rate, in percent. Defaults to ${pct(PROVISIONAL_SESSION_CVR)} — Shopify's all-traffic storefront funnel over the trailing 90 days (to ${PROVISIONAL_CVR_AS_OF}), NOT ad-attributed and provisional until live GA4 attribution lands. In conversion-bid mode this sets the achievable CPA (CPC ÷ CVR). Override with your own measured rate.`}
          />
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
          <TextField
            label="AOV override (€)"
            value={aovOverride}
            onChange={setAovOverride}
            placeholder={eur(api?.freshShopifyAov?.value ?? baseline?.aov.value)}
            tip="Average order value (€), GROSS / incl. VAT. Defaults to the fresh, comp-excluded Shopify store AOV (current, runs past the stale ad window). Net is derived via the VAT rate. Override to model a different basket."
          />
        </div>
        {model === "cps" && targetCpaOverride.trim() === "" && (
          <p className="mt-3 text-xs" style={{ color: "var(--text-secondary)" }}>
            Modeling your funnel&apos;s <strong>achievable</strong> CPA of{" "}
            <strong>{eur(impliedBaselineCpa)}</strong> (CPC {eur(baseline?.cpc.value)} ÷
            conversion rate {pct(effectiveCvrDisplay)}). Break-even CPA is{" "}
            <strong>{eur(breakEvenCpaDisplay)}</strong> (net AOV × margin) — the most you
            could pay and not lose money. You can only profit once the achievable CPA
            drops below break-even, i.e. by raising conversion rate. Conversion rate is
            the provisional Shopify figure; AOV is fresh Shopify. Type a target CPA above
            to explore a hypothetical.
          </p>
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

