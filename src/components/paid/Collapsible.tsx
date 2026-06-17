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
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className="w-full flex items-center justify-between gap-3 cursor-pointer"
      >
        <span className="text-base font-medium inline-flex items-center gap-2" style={{ color: "var(--text-primary, var(--text-secondary))" }}>
          <span className="inline-block w-1 h-4 rounded-full" style={{ background: "var(--brand)" }} />
          {title}
        </span>
        <span className="inline-flex items-center gap-2">
          {tip && <InfoTooltip text={tip} label={`About ${title}`} />}
          <span
            className="transition-transform text-xs"
            style={{ color: "var(--text-secondary)", transform: open ? "rotate(90deg)" : "rotate(0deg)" }}
            aria-hidden
          >
            ▶
          </span>
        </span>
      </button>
      {open && <div className="mt-4">{children}</div>}
    </div>
  );
}
