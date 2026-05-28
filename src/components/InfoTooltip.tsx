"use client";

import { useId, useState } from "react";

interface InfoTooltipProps {
  /** The explanatory text shown in the popover. */
  text: string;
  /** Optional accessible label for the trigger; defaults to "More information". */
  label?: string;
}

/**
 * A small "ⓘ" trigger with a real, visible tooltip on hover AND keyboard focus.
 *
 * Replaces the native HTML `title` attribute, which is unreliable: it appears
 * only after a long hover delay, never on focus, can't be styled, and on some
 * setups reads as empty. This renders a styled popover positioned above the
 * trigger, themed via CSS variables so it inverts with light/dark.
 */
/**
 * Render a tooltip string. If it contains "•" bullet markers (composite-score
 * breakdowns), split into a lead line plus one line per bullet. Otherwise
 * render as a single line.
 */
function renderTooltipLines(text: string) {
  if (!text.includes("•")) return text;
  const [lead, ...bullets] = text.split("•");
  return (
    <>
      {lead.trim() && <span>{lead.trim()}</span>}
      {bullets.map((b, i) => (
        <span key={i}>• {b.trim()}</span>
      ))}
    </>
  );
}

export default function InfoTooltip({ text, label }: InfoTooltipProps) {
  const [open, setOpen] = useState(false);
  const id = useId();

  return (
    <span className="relative inline-flex items-center">
      <button
        type="button"
        aria-label={label ?? "More information"}
        aria-describedby={open ? id : undefined}
        onMouseEnter={() => setOpen(true)}
        onMouseLeave={() => setOpen(false)}
        onFocus={() => setOpen(true)}
        onBlur={() => setOpen(false)}
        onClick={(e) => {
          // Tapping toggles on touch devices where there is no hover.
          e.preventDefault();
          setOpen((v) => !v);
        }}
        className="flex items-center justify-center w-3.5 h-3.5 rounded-full text-[9px] font-semibold leading-none cursor-help transition-colors"
        style={{
          background: "var(--bg-secondary)",
          color: "var(--text-secondary)",
          border: "1px solid var(--border)",
        }}
      >
        i
      </button>
      {open && (
        <span
          id={id}
          role="tooltip"
          className="absolute bottom-full left-1/2 -translate-x-1/2 mb-1.5 z-50 w-max max-w-[280px] px-2.5 py-1.5 rounded-md text-[11px] font-normal leading-snug pointer-events-none shadow-lg flex flex-col gap-0.5"
          style={{
            background: "var(--chart-tooltip-bg)",
            color: "var(--chart-tooltip-text)",
            border: "1px solid var(--border)",
            whiteSpace: "normal",
          }}
        >
          {/* Split on "•" so component breakdowns render as one line per item;
              plain tooltips (no bullets) render as a single line. */}
          {renderTooltipLines(text)}
        </span>
      )}
    </span>
  );
}
