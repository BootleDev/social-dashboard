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

Layout is answer-first. Render order: freshness banner → **verdict** (the first card,
leading with a plain-language headline — "Don't spend yet" / "Worth scaling" — plus the
canonical *achievable vs break-even CPA* comparison anchored right under it) → measured
baseline (collapsed evidence) → scenario inputs (open, for tuning) → projection (collapsed)
→ "what this spend buys" (collapsed) → best posts to promote. Only the inputs are open by
default; everything else is one click away, so the first screen is the answer. The scenario
inputs separate the two live **funnel** levers (conversion rate, AOV) from the
set-once **economics** constants (contribution margin, VAT, LTV), so the apparent decision
surface in the default mode is just the funnel. The verdict reads off the persisted
scenario, so it renders meaningfully on load. An ad-candidate list ranks existing organic
posts as paid creative.

## 2. The three bidding models

- **`cps` — conversion bid / target CPA (default).** How Meta is actually bought in 2026:
  `conversions = budget / CPA`. CPM/CPC/CTR are auction *outcomes*, not inputs, in this
  mode. There is no click/impression count and no break-even *CVR* (break-even *CPA* is the
  relevant line). **The CPA is DERIVED, not entered:** it's the achievable CPA the funnel
  delivers at the conversion rate you set (`achievable CPA = CPC ÷ CVR`). There is no free
  Target-CPA input — an earlier version had one, but it could be set to contradict the CVR,
  leaving the projection (which used the pinned CPA) ignoring the CVR field. Now CVR (plus
  AOV / margin) is the only control and the achievable CPA is a read-only derived readout,
  so the output always reflects the input. You don't pick a CPA; you earn it by improving
  the funnel. (CPC is stale, so the derived CPA is surfaced as directional, not a lynchpin.)
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
- **Net revenue, contribution, profit/sale, break-even** all use **net AOV =
  aov / (1 + vatRate)**. The margin input is a margin on *net* (ex-VAT) revenue.
- VAT rate is an adjustable input, default **20% (UK)**. There is no single Bootle VAT
  rate (DE 19, FR 20, IT 22, IE 23; variance absorbed at one EU price band).

**Margin is CONTRIBUTION margin, not gross margin (correctness decision).** The multiplier
on net AOV is contribution margin — net AOV retained after ALL variable per-order costs
(COGS + payment fees + shipping/fulfillment + pick-pack + returns provision), not gross
margin (COGS only). For an ad break-even decision the relevant margin is what an
*incremental* sale keeps after every variable cost it triggers; using gross margin would
overstate per-sale profit and make break-even CPA read too permissively (the dangerous
direction). Default is a derived ~50% estimate (`DEFAULT_CONTRIBUTION_MARGIN`: gross ~65%
minus ~15% other variable costs) — an assumption to replace with Bootle's measured figure.

## 4. Leverage & verdict (`adLeverage.ts`)

At break-even, `grossProfit = spend`. Each lever's single-variable factor to reach
break-even is closed-form: CVR / AOV / margin are **linear** (factor = `spend /
grossProfit`); the cost lever (targetCpa, or effective CPC) is **reciprocal** (factor =
`grossProfit / spend`). Margin is capped at 1.0, so a required margin > 100% is flagged
unreachable. In `cps` mode an **achievability gate** forces HOLD when the funnel's
achievable CPA (CPC ÷ measured CVR) sits materially above the **break-even CPA** — i.e. the
funnel can't deliver a profitable cost per sale. The gate keys off break-even, NOT off the
scenario's (derived) target CPA: since target CPA = CPC ÷ the CVR field, an
achievable-vs-target test would reduce to "is the CVR field above the measured rate?" and
never fire in the default state (CVR field == measured). Keying off break-even makes the
"your funnel can't pay for ads" verdict fire whenever it's genuinely true, regardless of
what CVR is modeled. Lever rows in cps are anchored to the MEASURED funnel (re-run at the
achievable CPA), so the table can't simultaneously read "AOV nearly fine" (optimistic) and
"CVR hopeless" (measured) — an unviable funnel reads consistently across all rows.

Each lever surfaces, in **real units**, its break-even threshold (a floor for
CVR/AOV/margin, a ceiling for cost) next to its current value, plus a **profit
sensitivity** — €/profit per natural step (+1pp for rates, +€1 for money). Levers are
**ranked by that sensitivity** (largest |€/step| first), and the top reachable one is
flagged **binding** ("watch"). This matters: all three lift levers (CVR/AOV/margin) share
the same multiplicative break-even *factor*, so ranking on the factor alone tied them and
the binding pick collapsed to array order (always the first lever, e.g. AOV in cps mode).
Profit-per-step is genuinely lever-specific — it's the €-impact of the unit the operator
actually moves (you change CVR by points, not by multiplying it) — so it breaks the tie
to the lever whose real-world drift most swings profit.

**Levers by mode.** Traffic models (cpc/cpm) expose the real cost input (CPC/CPM price) as
the cost lever. Conversion-bid (cps) does NOT — its CPA is derived from CVR, so a
"target-CPA lever" would be self-referential and contradict the verdict (which names
conversion rate as the constraint). Instead, when the caller passes the funnel's measured
CVR + achievable CPA, cps surfaces a real **Conversion-rate lever**: current CVR → the CVR
needed to break even (`required CVR = measured CVR × achievable CPA ÷ break-even CPA`). When
the achievability gate has fired, that CVR row is flagged as **the blocker** (matching the
verdict) even though it's "unreachable" on its own — it's the answer, not a tuning knob, so
the row shows the multiple it must move by (e.g. "needs 6.3×") rather than a misleading
one-step €/leverage figure. The verdict summary stays to one plain sentence; the concrete
numbers (target CPA, required CVR lift) live once in the recommendation line, not repeated.

When **no lever is reachable on its own** (a deeply-losing run — a margin that would need
>100%, a CPA that must more than halve), no lever is flagged binding: there is no honest
single thing to "watch", so the verdict says the funnel needs structural work and the lever
table reads as reference, not a to-do list. This is deliberate — pointing the operator at
an impossible lever (highest raw sensitivity but unreachable) would be misleading. Each
lever row shows **now → floor/ceiling** (where it sits vs where it must reach) and the
**€/step** leverage, with a red "needs structural move" tag when it can't cross alone.

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

**Ad-candidate ranker (`adCandidate.ts`).** Ranks existing organic posts as paid creative
on the signals that predict ad success, content-deduped (same caption + media collapses to
one). Two views:
- **Save + share rate** (UI label; `viralityIndex`, the default) — `(saves + shares) /
  reach`, volume- and recency-weighted. One honest denominator across platforms, so it's
  the defensible cross-platform ranker. Displayed as **saves + shares per 1,000 reach** (the
  raw ratio is an illegible 0.0xx). A secondary **/like** figure rides along per row for
  context; it is *not* a sort option — likes are a cheap signal, so the module won't rank
  on them.
- **Engagement quality** (UI label; `intentScore`) — a 0–100 composite of the active-intent
  components (comment/save/outbound-click rates) benchmarked per platform. **Caveat:** it
  renormalizes each platform's intent slice to 0–100, so an 80 means "strong for that
  platform", not an absolute cross-platform magnitude — which is why the default view is
  save + share rate. Both toggles carry hover tooltips spelling out the formula + when to
  use which.

Each row carries a plain-language **rationale** (`candidateRationale`) derived from the
same breakdown — e.g. "strong saves + shares (3.0% of reach) · fresh creative", or caveats
like "thin reach — treat as directional" / "older creative — refresh before scaling".
Weights: a log-dampened **volume** confidence factor (caps at a reach anchor so it doesn't
reward accumulated reach, which tracks post age), a half-life **recency** decay (fresh
creative outranks a stale post of equal rate), an optional video **retention** factor
(hook × hold), and a **demo-fit** weight (wired but inert until a target profile + per-post
demographics land).

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
