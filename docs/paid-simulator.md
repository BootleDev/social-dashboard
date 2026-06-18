# Paid Simulator — Design & Data Notes

Status: built, on `feat/paid-simulator`. The "Paid" tab of the social dashboard. It
answers one question for the operator: **given our real economics, should we scale ad
spend — and if not, what's the single highest-leverage thing to fix first?** It is a
decision tool, not just a calculator.

---

## 1. What it does

You set a budget and a bidding basis; the tool projects sales, profit, and break-even
from a measured baseline, then renders a plain-language **verdict** (SCALE / MARGINAL /
HOLD) plus a ranked list of **levers** showing how far each input would have to move on
its own to reach break-even. The highest-leverage fix is the reachable lever needing the
smallest change.

Layout is answer-first: the verdict leads, the editable scenario and the full projection
table are collapsible below it, and the measured baseline is demoted to collapsed
supporting evidence. An ad-candidate list ranks existing organic posts as paid creative.

## 2. The three bidding models

- **`cps` — conversion bid / target CPA (default).** How Meta is actually bought in 2026:
  you set a budget and a target CPA (cost cap / ROAS goal); `conversions = budget /
  targetCpa`. CPM/CPC/CTR are auction *outcomes*, not inputs, in this mode. There is no
  click/impression count and no break-even *CVR* (break-even *CPA* is the relevant line).
- **`cpc` — pay per click (diagnostic).** `clicks = budget / CPC`, then the funnel.
- **`cpm` — pay per 1,000 impressions (diagnostic).** `impressions = budget / CPM × 1000`,
  `clicks = impressions × CTR`, then the funnel.

All three converge on one shared money tail (`runFromConversions` in `adEconomics.ts`), so
revenue/profit/break-even math exists in exactly one place.

## 3. VAT (the correctness decision)

AOV is **gross** (VAT-inclusive — what the customer paid; Bootle storefront prices show
incl. VAT). VAT is remitted, never income, so:
- **Revenue and ROAS stay gross** (ad-platform convention; they reconcile against Ads
  Manager). Labeled "incl. VAT" / "Attributed ROAS".
- **Net revenue, gross profit, profit/sale, break-even** all use **net AOV =
  aov / (1 + vatRate)**. The gross margin is a margin on *net* (ex-VAT) revenue — the
  standard COGS convention.
- VAT rate is an adjustable input, default **20% (UK)**. There is no single Bootle VAT
  rate (DE 19, FR 20, IT 22, IE 23; variance absorbed at one EU price band).

## 4. Leverage & verdict (`adLeverage.ts`)

At break-even, `grossProfit = spend`. Each lever's single-variable factor to reach
break-even is closed-form: CVR / AOV / margin are **linear** (factor = `spend /
grossProfit`); the cost lever (targetCpa, or effective CPC) is **reciprocal** (factor =
`grossProfit / spend`). Margin is capped at 1.0, so a required margin > 100% is flagged
unreachable. In `cps` mode an **achievability gate** forces HOLD when the funnel's
achievable CPA (CPC ÷ CVR) sits materially above the target CPA — a target can be
profitable on paper yet unreachable by the current funnel.

Each lever surfaces, in **real units**, its break-even threshold (a floor for
CVR/AOV/margin, a ceiling for cost) next to its current value, plus a **profit
sensitivity** — €/profit per natural step (+1pp for rates, +€1 for money). The lever with
the thinnest margin of safety is flagged **binding** ("watch") — the one most likely to
tip the campaign, and the highest-leverage thing to move. The CVR lever appears only in
the traffic (cpc/cpm) diagnostic modes; in conversion-bid (cps) the target-CPA lever *is*
the conversion economics, so a standalone CVR lever is omitted rather than shown as
"not computable".

**Traffic & time-to-learn (`forecastTraffic`).** Given the recommended daily budget, the
tool forecasts the volume it buys (sessions/conversions per day/week/month) and how many
days until you accumulate enough conversions to (a) exit Meta's learning phase (~50/ad
set) and (b) reach a readable sample (~150). This answers the operator's "will I have
enough data to test?" question before spending: at a ~0.2% funnel on a small budget,
conversions trickle in so a readable sample can be hundreds of days out — a decisive
signal that the funnel must be fixed before paid is even learnable. Counts scale linearly
from a one-day run (no saturation modelling), so large-budget figures are optimistic.

**Recommendation (`recommend`).** The report also carries a concrete
DO/DON'T recommendation synthesized from the model's own constraints: a target CPA a
safety margin (20%) below break-even, and a starting daily budget = the learning-phase
floor at that CPA (so Meta gets enough conversions to optimize). It is more conservative
than the bare verdict — a scenario that's profitable right on the break-even knife-edge
recommends HOLD (no safety buffer) and names the CVR lift needed. When the funnel can't
deliver the recommended CPA, it says don't spend and quantifies the required CVR rise.

## 5. Data sources & provisional baseline

Reads the Airtable **Marketing Intelligence** base (`appIyePhrYZBUxCP9`):
- **Daily Aggregates** — account-grain spend / impressions / clicks / purchases.
- **Ad Snapshots** — one ad per day, ad-attributed clicks / purchases / purchase value.
- **Shopify Daily Sales** — whole-store orders / gross / net / discounts (currency-aware).

Estimation (`adBaseline.ts`) pools ratios (sum numerators ÷ sum denominators) over the
most-recent active-spend window, with minimum-volume confidence gating and Wilson
intervals on CVR.

**Provisional defaults (current state, 2026-06).** Ad spend in the data ended
**2026-01-22**, so the ad-price baseline (CPC/CPM/CTR) is stale and a freshness banner
warns when it is. Until live GA4 purchase attribution is wired (WEBDEV-103), the defaults
are sourced from fresh Shopify data instead:
- **Conversion rate defaults to `PROVISIONAL_SESSION_CVR` (0.2%)** — Shopify Analytics'
  storefront funnel (sessions → completed checkout, trailing 90 days). All-traffic, not
  ad-attributed; a documented editable constant in `adScenario.ts`. The same funnel shows
  the binding leak is sessions → add-to-cart (~2.3%), consistent with WEBDEV-149.
- **AOV defaults to the fresh, comp-excluded Shopify store AOV** (runs months past the
  stale ad window).

## 6. Data-integrity filters (validated against live data 2026-06-17)

- **Phantom conversions dropped:** ad rows with a purchase on zero clicks (view-through /
  sync artifacts, e.g. 2026-01-25/26) are excluded and counted in flags.
- **Value-bearing ad-AOV:** AOV divides by purchases that actually carry a value, not by a
  count inflated with zero-value rows.
- **Comp orders excluded:** Shopify rows with net ≤ 0 or discounts ≥ gross (100%-off
  comp/test orders) are dropped from AOV.
- **Fractional conversions preserved:** Meta reports modeled conversions as decimals;
  ad-conversion counts parse with `numNonNeg` (no flooring), so 0.6 isn't dropped to 0.
  `count()` (integer-flooring) is kept only for true tallies (clicks, impressions, orders).

## 7. Known limits / follow-ups

- **CPC/CPM/CTR refresh only when ads run again** (or spend data is backfilled). The
  freshness banner makes the staleness explicit.
- **Live GA4 session-grain CVR/bounce depends on WEBDEV-103** (purchase attribution).
  When it lands, replace the provisional constant with a live feed via the existing
  session-grain override path. Until then CVR is a documented, editable placeholder.
- **Linear-at-scale:** returns are projected at a constant rate; real returns taper at
  higher budgets (auction saturation, frequency/CPM creep, creative fatigue). Surfaced as
  a caveat, not modeled.
- **Attributed, not incremental:** ROAS is platform-reported on modeled conversions, not
  blended MER; real incremental return is lower.

## 8. Files

- `src/lib/adScenario.ts` — types, tunable constants (`LEARNING_PHASE` = 50 events/7d,
  `DEFAULT_VAT_RATE`, `PROVISIONAL_SESSION_CVR`), input sentinels, grain invariant.
- `src/lib/adEconomics.ts` — funnel + profit/break-even math (pure).
- `src/lib/adBaseline.ts` — pooled estimation + data-integrity filters + default window.
- `src/lib/adSimulate.ts` — resolve scenario from baseline + overrides; low/expected/high band.
- `src/lib/adLeverage.ts` — verdict + lever ranking (pure).
- `src/lib/adCandidate.ts` — rank organic posts as ad creative (content-deduped).
- `src/lib/marketingIntelligence.ts` — Airtable reader (server-only).
- `src/app/api/paid/route.ts` — pools the baseline + fresh Shopify AOV, returns to the client.
- `src/components/PaidPanel.tsx` — the tab; `src/components/paid/` — extracted primitives,
  `Collapsible`, `LeveragePanel`.

Full math/UX rationale lives in the commit history and the build plans; this doc is the
durable summary.
