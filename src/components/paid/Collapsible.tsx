"use client";

/**
 * A collapsible card section for the Paid tab. Theme-aware, keyboard-accessible
 * (button summary, aria-expanded), animated chevron. `defaultOpen` sets the
 * initial state. Used to demote secondary detail (scenario inputs, full
 * projection, baseline) below the answer-first verdict.
 */

import { useState } from "react";
import InfoTooltip from "../InfoTooltip";
import { card } from "./primitives";

export default function Collapsible({
  title,
  tip,
  defaultOpen = true,
  children,
}: {
  title: string;
  tip?: string;
  defaultOpen?: boolean;
  children: React.ReactNode;
}) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div className="rounded-xl p-5" style={card}>
      {/* Header is a flex row, NOT a single wrapping button — the tooltip is its
          own button and must not nest inside another (invalid HTML + the tooltip
          tap would toggle the collapse). The collapse toggle is the title button;
          the tooltip sits beside it. */}
      <div className="flex items-center justify-between gap-3">
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          aria-expanded={open}
          className="flex items-center gap-2 cursor-pointer text-base font-medium"
          style={{ color: "var(--text-primary, var(--text-secondary))" }}
        >
          <span className="inline-block w-1 h-4 rounded-full" style={{ background: "var(--brand)" }} />
          {title}
          <span
            className="transition-transform text-xs"
            style={{ color: "var(--text-secondary)", transform: open ? "rotate(90deg)" : "rotate(0deg)" }}
            aria-hidden
          >
            ▶
          </span>
        </button>
        {tip && <InfoTooltip text={tip} label={`About ${title}`} />}
      </div>
      {open && <div className="mt-4">{children}</div>}
    </div>
  );
}
