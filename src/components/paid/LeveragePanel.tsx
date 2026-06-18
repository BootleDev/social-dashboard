"use client";

/**
 * The Paid-tab decision panel: a color-coded verdict ("what should I do?") plus
 * the levers ranked by leverage ("what do I fix first?"). Reads a pure
 * LeverageReport from adLeverage.ts — no math here, presentation only.
 */

import type { LeverageReport, Lever } from "@/lib/adLeverage";
import InfoTooltip from "../InfoTooltip";
import { card } from "./primitives";

/**
 * Per-status: color, short badge, and a PLAIN-LANGUAGE headline a CEO reads as
 * the answer (no jargon — "MARGINAL" was ambiguous). The headline is the loudest
 * thing on the page; the summary below is supporting detail.
 */
const VERDICT_STYLE: Record<
  LeverageReport["verdict"]["status"],
  { bg: string; label: string; headline: string }
> = {
  scale: { bg: "var(--success, #16a34a)", label: "SCALE", headline: "Worth scaling" },
  marginal: { bg: "var(--warning, #d97706)", label: "BORDERLINE", headline: "Too close to call" },
  hold: { bg: "var(--danger, #dc2626)", label: "HOLD", headline: "Don’t spend yet" },
};

const fmtEur0 = (v: number) => `€${Math.abs(Math.round(v)).toLocaleString("en-IE")}`;
const fmtVal = (v: number | undefined, unit: Lever["unit"]) =>
  v === undefined ? "—" : unit === "pct" ? `${(v * 100).toFixed(2)}%` : fmtEur0(v);

/** Input names — match the scenario input labels so nothing is renamed twice. */
const PLAIN_LABEL: Record<Lever["key"], string> = {
  cvr: "Conversion rate",
  aov: "Average order value",
  contributionMargin: "Contribution margin",
  cost: "Ad cost",
};

/**
 * Whether the input is currently ON THE GOOD SIDE of its break-even threshold
 * (above the floor for lift inputs, below the ceiling for cost). undefined when
 * not computable.
 */
function leverIsHealthy(l: Lever): boolean | undefined {
  if (l.currentValue === undefined || l.breakEvenValue === undefined) return undefined;
  return l.key === "cost"
    ? l.currentValue <= l.breakEvenValue
    : l.currentValue >= l.breakEvenValue;
}

/**
 * One plain-English detail line for a row, e.g.
 *   "€68 now · works above €55"            (healthy)
 *   "0.19% now · needs ~1.2% (6× better)"  (the problem, by a multiple)
 * No "floor / ceiling / €-per-step" jargon — that lives in the tooltip.
 */
function plainDetail(l: Lever): string {
  const now = fmtVal(l.currentValue, l.unit);
  const target = fmtVal(l.breakEvenValue, l.unit);
  if (l.currentValue === undefined || l.breakEvenValue === undefined) return `${now} now`;
  const healthy = leverIsHealthy(l);
  if (healthy) {
    // Cost is "works below"; everything else "works above" its threshold.
    return l.key === "cost" ? `${now} now · works below ${target}` : `${now} now · works above ${target}`;
  }
  // Needs to move to the target. Express the gap as a multiple when it's a lift
  // input (the intuitive "Nx better"); cost just states the target to get under.
  if (l.key === "cost") return `${now} now · needs to drop under ${target}`;
  const mult =
    l.factor !== undefined && l.factor > 1 ? ` (${l.factor.toFixed(1)}× better)` : "";
  return `${now} now · needs ~${target}${mult}`;
}

/** The math, kept for the per-row tooltip (anyone who wants the derivation). */
function rowTooltip(l: Lever): string {
  const now = fmtVal(l.currentValue, l.unit);
  const target = fmtVal(l.breakEvenValue, l.unit);
  const side = l.key === "cost" ? "stay under" : "stay above";
  const lever =
    l.profitPerStep !== undefined
      ? ` Each ${l.stepLabel === "+1pp" ? "+1 percentage point" : "+€1"} changes total profit by about ${l.profitPerStep >= 0 ? "+" : "−"}${fmtEur0(l.profitPerStep)}.`
      : "";
  const reach = l.reachable
    ? " A realistic change on this one input alone could get there."
    : " No realistic single change to this input alone gets there — it needs a structural shift (or other inputs moving too).";
  return `Currently ${now}; to break even it must ${side} ${target}.${lever}${reach}`;
}

/**
 * The single canonical CPA comparison (achievable vs break-even) the rest of the
 * page references. Optional — only conversion-bid mode supplies it.
 */
export interface CpaAnchor {
  /** What the funnel can deliver per sale today (CPC ÷ measured CVR), EUR. */
  achievable: number | undefined;
  /** The most you can pay per sale and still profit (net AOV × margin), EUR. */
  breakEven: number | undefined;
}

/**
 * The canonical "what you can pay vs what pays off" comparison, rendered once
 * under the headline. Two figures + a one-line read on the gap — the single
 * anchor every other CPA mention on the page refers back to.
 */
function CpaCompare({ anchor, accent }: { anchor: CpaAnchor; accent: string }) {
  const { achievable, breakEven } = anchor;
  const profitable =
    achievable !== undefined && breakEven !== undefined ? achievable <= breakEven : undefined;
  const gap =
    achievable !== undefined && breakEven !== undefined && breakEven > 0
      ? achievable / breakEven
      : undefined;
  return (
    <div
      className="rounded-lg px-3.5 py-2.5 mb-4 flex flex-wrap items-center gap-x-4 gap-y-1"
      style={{ background: "var(--bg-primary)" }}
    >
      <span className="text-sm">
        <span style={{ color: "var(--text-secondary)" }}>Funnel delivers </span>
        <strong className="tabular-nums">{fmtEur0(achievable ?? NaN) === "€NaN" ? "—" : fmtEur0(achievable!)}</strong>
        <span style={{ color: "var(--text-secondary)" }}> per sale</span>
      </span>
      <span aria-hidden style={{ color: "var(--text-secondary)" }}>vs</span>
      <span className="text-sm">
        <span style={{ color: "var(--text-secondary)" }}>break-even </span>
        <strong className="tabular-nums">{breakEven === undefined ? "—" : fmtEur0(breakEven)}</strong>
      </span>
      {profitable !== undefined && (
        <span
          className="text-[11px] font-medium px-1.5 py-0.5 rounded"
          style={{
            background: profitable ? "var(--success, #16a34a)22" : `${accent}22`,
            color: profitable ? "var(--success, #16a34a)" : accent,
          }}
        >
          {profitable
            ? "below the line — profitable"
            : gap !== undefined
              ? `${gap.toFixed(gap >= 10 ? 0 : 1)}× over the line`
              : "above the line"}
        </span>
      )}
    </div>
  );
}

export default function LeveragePanel({
  report,
  cpaAnchor,
}: {
  report: LeverageReport;
  cpaAnchor?: CpaAnchor;
}) {
  const { verdict, levers, recommendation } = report;
  const style = VERDICT_STYLE[verdict.status];
  // Show the "no single lever fixes this" banner whenever no row in the table is
  // the answer — either nothing is reachable, or (conversion-bid) the real
  // constraint is the funnel's conversion rate, which isn't a row here.
  const noBindingRow = !levers.some((l) => l.binding);
  return (
    <div className="rounded-xl p-5" style={{ ...card, borderLeft: `4px solid ${style.bg}` }}>
      {/* HEADLINE — the loudest thing on the page: a plain-language answer + a
          small status badge. This is what a CEO reads first. */}
      <div className="flex items-center gap-2.5 mb-1">
        <span
          className="text-[10px] font-bold px-2 py-0.5 rounded tracking-wide"
          style={{ background: style.bg, color: "#fff" }}
        >
          {style.label}
        </span>
        <span className="text-[11px] uppercase tracking-wide" style={{ color: "var(--text-secondary)" }}>
          Verdict
        </span>
        <InfoTooltip
          text="The decision on the current scenario: scale, hold, or fix the funnel first. The table below shows which inputs are fine and which is the problem; 'What this spend buys' shows the traffic and whether you can test at this budget."
          label="What is the verdict?"
        />
      </div>
      <h3
        className="text-2xl font-semibold leading-tight mb-1.5"
        style={{ color: style.bg }}
      >
        {style.headline}
      </h3>
      {/* Summary — supporting detail under the headline. */}
      <p className="text-sm leading-snug mb-3" style={{ color: "var(--text-primary, var(--text-secondary))" }}>
        {verdict.summary}
      </p>

      {/* THE CANONICAL CPA COMPARISON — the one number pair the rest of the page
          references, anchored here under the headline so it's not scattered. */}
      {cpaAnchor && (cpaAnchor.achievable !== undefined || cpaAnchor.breakEven !== undefined) && (
        <CpaCompare anchor={cpaAnchor} accent={style.bg} />
      )}

      {/* Concrete recommendation — the advisor line. Labelled (not a DO/DON'T
          badge that collided with the "Don't…" summary text). */}
      <div
        className="rounded-lg px-3.5 py-3 mb-4"
        style={{
          background: "var(--bg-primary)",
          borderLeft: `3px solid ${recommendation.action === "spend" ? "var(--success, #16a34a)" : "var(--danger, #dc2626)"}`,
        }}
      >
        <div
          className="text-[10px] font-semibold uppercase tracking-wide mb-1"
          style={{ color: "var(--text-secondary)" }}
        >
          Recommended next step
        </div>
        <div className="text-sm font-medium" style={{ color: "var(--text-primary, var(--text-secondary))" }}>
          {recommendation.summary}
        </div>
      </div>

      {/* No row in the table is the answer — say so plainly instead of leaving
          the operator to wonder why nothing is flagged (or, worse, highlighting
          an impossible lever as the thing to "watch"). */}
      {verdict.status !== "scale" && noBindingRow && (
        <div
          className="rounded-lg px-3 py-2 mb-3 text-xs"
          style={{ background: `${style.bg}11`, border: `1px solid ${style.bg}33`, color: "var(--text-primary, var(--text-secondary))" }}
        >
          No single input below crosses break-even on its own — the table is
          reference, not a to-do list. The funnel needs structural work; see the
          recommended next step above.
        </div>
      )}

      <div className="flex items-baseline justify-between gap-3 mb-2">
        <div className="text-xs font-medium" style={{ color: "var(--text-secondary)" }}>
          Your inputs — which are fine, and which is the problem
        </div>
        <InfoTooltip
          text="Each input is checked against what it would need to be for ads to break even. A ✓ means that input is fine as it is. The ⛔ row is the one holding you back — and whether it's a quick tweak or a structural fix. Hover any row for the exact numbers."
          label="How do I read this?"
        />
      </div>
      <div className="space-y-1.5">
        {levers.map((l) => {
          const healthy = leverIsHealthy(l);
          // The status: green ✓ when this input is already fine; the verdict
          // color + ⛔ when it's the binding problem; a neutral caution otherwise.
          const isProblem = l.binding;
          const statusGlyph = isProblem ? "⛔" : healthy ? "✓" : "•";
          const statusColor = isProblem
            ? style.bg
            : healthy
              ? "var(--success, #16a34a)"
              : "var(--text-secondary)";
          const statusWord = isProblem
            ? "the problem"
            : healthy
              ? "fine"
              : "below the line";
          // Only a genuinely out-of-reach problem gets the "big jump" footnote.
          const bigJump = isProblem && !l.reachable;
          return (
            <div
              key={l.key}
              className="rounded-lg px-3 py-2"
              style={{
                background: "var(--bg-primary)",
                borderLeft: `3px solid ${isProblem ? style.bg : "transparent"}`,
                boxShadow: isProblem ? `inset 0 0 0 1px ${style.bg}33` : undefined,
              }}
              title={rowTooltip(l)}
            >
              <div className="flex items-center gap-2 text-sm">
                <span aria-hidden style={{ color: statusColor }}>{statusGlyph}</span>
                <span className={isProblem ? "font-semibold" : ""}>{PLAIN_LABEL[l.key]}</span>
                <span className="text-[11px]" style={{ color: statusColor }}>
                  — {statusWord}
                </span>
              </div>
              <div className="text-[11px] mt-0.5 tabular-nums" style={{ color: "var(--text-secondary)" }}>
                {plainDetail(l)}
                {bigJump && (
                  <span style={{ color: "var(--danger, #dc2626)" }}> · a big jump, not a quick fix</span>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
