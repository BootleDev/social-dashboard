# Social Dashboard — Personas & Lane-Based IA Spec

Status: proposal, not yet built. Written 2026-06-04 after the data-correctness sweep
(WEBDEV-146). The numbers are now trustworthy; this spec is about making sure each
audience can find and act on them. Decision on record: serve **two audiences as
equal, distinct lanes** rather than one undifferentiated nav.

---

## 1. Personas

### Persona A — Leadership / ELT (the decision lane)
- **Who:** CEO and exec team.
- **Job to be done:** "Are we winning, is it working, what needs my attention?" — answered in under 60 seconds, no digging, no interpreting raw tables.
- **Reads:** outcomes and direction, not mechanics. Wants a number, a trend, and a flag.
- **Frequency:** a quick check-in, often on mobile.
- **Success:** can state "we're up/down, here's why, here's the one thing to watch" after a glance.

### Persona B — Social / content manager (the production lane)
- **Who:** Alex (and future social hires).
- **Job to be done:** the weekly content loop — "what worked → what should I make next → when/how do I ship it?"
- **Reads:** depth — per-format/theme/hook performance, timing, hashtags, audience, competitors.
- **Frequency:** the daily/weekly workhorse; lives in the depth tabs.
- **Success:** leaves with a concrete content decision (make X format on Y theme, post at Z).

### Persona C — Data / analytics engineer (supporting, cross-lane)
- **Job to be done:** "Can I trust this number? Where does it come from?"
- **Served by:** the Methodology page (now a live data-lineage surface — well covered as of WEBDEV-146). No further IA work needed; keep it linked from every metric tooltip.

### Persona D — Ops / data steward (supporting, cross-lane)
- **Job to be done:** "Is the pipeline healthy? Is anything stale or broken?"
- **Served by:** Ops → Health (PipelineHealth). Adequate but buried; a freshness signal should be visible to both primary lanes (a leader also implicitly needs "is this fresh?").

---

## 2. Current IA and why it blurs the lanes

Today's top-level nav is organized **by data type**, not by audience:

- **Pulse** — daily check-in (Overview)
- **Insights** — EDA (Post performance / Audience / Pinterest / Hashtags)
- **Planning** — production (Best Time / Pinterest trends / Competitor)
- **Ops** — Tagging / Platform Compare / Health
- **Methodology** — data lineage

Both primary personas traverse the same tabs and stop at different depths. There is
no signal of "which lane am I in," and the leadership payoff (a narrative read) and
the operator payoff (a connected make-content loop) are both under-served by a
type-organized structure.

### The four concrete gaps
1. **No lane entry point / signal.** Leader and operator both land on Pulse with no
   indication of their home or path. Two equal audiences, one undifferentiated nav.
2. **Pulse lacks the Lane-A payoff: narrative.** It shows correct numbers (post-level
   headline + per-platform scorecards, as of the correctness sweep) but not the
   *so-what*: no north-star, no period-over-period story ("▲12% WoW, driven by
   Reels"), no single "needs attention." Top Findings exists but lives under Insights.
3. **The operator loop spans disconnected tabs.** "Theme X performed" (Insights) →
   "so schedule X at time Y" (Planning) has no bridge; the loop's steps aren't linked.
4. **Pipeline health is buried** under Ops, though freshness is a cross-lane concern.

---

## 3. Proposed lane-based IA

Reframe around the two lanes **without a ground-up rebuild** — re-home and connect
existing surfaces rather than rewrite them.

### Lane A — Leadership (Pulse becomes the complete 60-second read)
- **North-star strip** at the top: the 1-2 numbers that define "are we winning"
  (proposed: total post-level reach/engagement trend + follower trajectory), each
  with a clear period-over-period delta and direction.
- **WoW / period narrative:** a one-line generated summary ("Reach ▲12% vs prior
  period, driven by Instagram Reels; engagement flat"). Derived from existing kpi
  deltas + per-platform breakdowns — no new data.
- **"Needs attention":** pull Top Findings (currently under Insights) up to Pulse as
  the single triage list a leader scans.
- Keep the corrected headline KPIs + per-platform scorecards already shipped.
- Net: a leader never has to leave Pulse for the decision-level read.

### Lane B — Operator (Insights + Planning cohere into the make-content loop)
- Make the loop's steps connected: from a winning theme/format/time in Insights,
  a "plan from this" affordance that carries the selection into Planning (or a
  unified Insights→Planning flow). The two tabs stay, but the bridge between
  "what worked" and "what to make/when" becomes explicit.
- This lane is Alex's — his input should shape the exact loop before building.

### Cross-lane
- **Lane signal in the nav:** lightweight grouping/labeling so each persona knows
  their home (e.g. a subtle "Overview" vs "Workspace" framing, or role-oriented
  section labels) — without hiding any tab from anyone.
- **Global freshness indicator:** a small "data current as of <date> · pipeline
  healthy/stale" chip visible in the header on every tab, reading the same signal
  the Health panel uses. Serves the steward need and reassures leadership.

---

## 4. Build plan (staged, each step independently shippable)

1. **Leadership lane on Pulse** (self-contained; Overview only):
   north-star strip + WoW narrative + pull Top Findings onto Pulse.
   *Highest single IA gain; no nav restructure.*
2. **Global freshness chip** in the header (reads PipelineHealth's signal).
3. **Nav lane signal** (grouping/labels; no tab removed).
4. **Insights↔Planning operator-loop bridge** (review with Alex first — his surface).

Recommended order: 1 → 2 → 3 → 4. Steps 1-3 are leadership/cross-lane and
independent; step 4 is the operator lane and should incorporate Alex's input.

### Guardrails for the build
- Don't regress the data-correctness work (reach-weighted rates, honest absences,
  per-platform grain). The IA reframe is presentation/navigation only.
- Keep every metric's Methodology tooltip link intact.
- tsc + tests + build green after each step; verify on preview before the next.

---

## 5. Open questions for the team
- Lane A north-star: which 1-2 numbers best mean "are we winning" to the ELT?
- Lane B (Alex): what's the real weekly loop in his words — does the
  Insights→Planning bridge match how he actually decides what to make?
- Should the nav visibly separate lanes, or stay unified with subtler signposting?
