"use client";

/**
 * The Paid-tab decision panel: a color-coded verdict ("what should I do?") plus
 * the levers ranked by leverage ("what do I fix first?"). Reads a pure
 * LeverageReport from adLeverage.ts — no math here, presentation only.
 */

import type { LeverageReport } from "@/lib/adLeverage";
import InfoTooltip from "../InfoTooltip";
import { card } from "./primitives";

/** Colors + badge text for each verdict status. */
const VERDICT_STYLE: Record<
  LeverageReport["verdict"]["status"],
  { bg: string; label: string }
> = {
  scale: { bg: "var(--success, #16a34a)", label: "SCALE" },
  marginal: { bg: "var(--warning, #d97706)", label: "MARGINAL" },
  hold: { bg: "var(--danger, #dc2626)", label: "HOLD" },
};

export default function LeveragePanel({ report }: { report: LeverageReport }) {
  const { verdict, levers, recommendation } = report;
  const style = VERDICT_STYLE[verdict.status];
  return (
    <div className="rounded-xl p-5" style={{ ...card, borderLeft: `4px solid ${style.bg}` }}>
      <div className="flex items-center gap-2 mb-2">
        <span
          className="text-xs font-bold px-2.5 py-1 rounded"
          style={{ background: style.bg, color: "#fff" }}
        >
          {style.label}
        </span>
        <h3 className="text-base font-medium" style={{ color: "var(--text-primary, var(--text-secondary))" }}>
          Verdict — what should I do?
        </h3>
        <InfoTooltip
          text="A decision read on the current scenario: whether to scale, and which single input is the binding constraint. The lever ranking below shows how far each input must move ON ITS OWN to reach break-even — the highest-leverage fix is the reachable lever needing the smallest change."
          label="What is the verdict?"
        />
      </div>
      <p className="text-sm mb-3">{verdict.summary}</p>

      {/* Concrete recommendation — the advisor line. */}
      <div
        className="rounded-lg px-3 py-2 mb-4 text-sm inline-flex items-start gap-2"
        style={{ background: "var(--bg-primary)" }}
      >
        <span
          className="text-[10px] font-bold px-1.5 py-0.5 rounded mt-0.5 shrink-0"
          style={{
            background: recommendation.action === "spend" ? "var(--success, #16a34a)" : "var(--danger, #dc2626)",
            color: "#fff",
          }}
        >
          {recommendation.action === "spend" ? "DO" : "DON'T"}
        </span>
        <span>{recommendation.summary}</span>
      </div>
      <div className="text-xs font-medium mb-2" style={{ color: "var(--text-secondary)" }}>
        Levers — break-even threshold (real units) + profit sensitivity. The
        highlighted row is the binding constraint: thinnest margin, watch it first.
      </div>
      <div className="space-y-1.5">
        {levers.map((l) => (
          <div
            key={l.key}
            className="flex items-center justify-between gap-3 rounded-lg px-3 py-1.5"
            style={{
              background: "var(--bg-primary)",
              // Highlight the binding lever with a left accent + subtle ring.
              borderLeft: l.binding ? `3px solid ${style.bg}` : "3px solid transparent",
              boxShadow: l.binding ? `inset 0 0 0 1px ${style.bg}33` : undefined,
            }}
          >
            <span className="text-sm inline-flex items-center gap-2">
              <span
                className="inline-block w-1.5 h-1.5 rounded-full"
                style={{ background: l.reachable ? "var(--success, #16a34a)" : "var(--danger, #dc2626)" }}
                title={l.reachable ? "reachable on its own" : "cannot fix this alone"}
              />
              <span className={l.binding ? "font-semibold" : ""}>{l.label}</span>
              {l.binding && (
                <span
                  className="text-[10px] px-1.5 py-0.5 rounded"
                  style={{ background: `${style.bg}22`, color: style.bg }}
                >
                  watch
                </span>
              )}
            </span>
            <span className="text-xs text-right" style={{ color: "var(--text-secondary)" }}>
              {l.note}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}
