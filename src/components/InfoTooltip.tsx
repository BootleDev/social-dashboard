"use client";

import {
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import { createPortal } from "react-dom";

interface InfoTooltipProps {
  /** The explanatory text shown in the popover. */
  text: string;
  /** Optional accessible label for the trigger; defaults to "More information". */
  label?: string;
}

/** Fixed-position coordinates (viewport-relative) for the portaled popover. */
interface TooltipPosition {
  top: number;
  left: number;
}

/** Gap in px between the trigger and the popover. */
const TOOLTIP_GAP = 6;

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

/**
 * A small "ⓘ" trigger with a real, visible tooltip on hover AND keyboard focus.
 *
 * Replaces the native HTML `title` attribute, which is unreliable: it appears
 * only after a long hover delay, never on focus, can't be styled, and on some
 * setups reads as empty.
 *
 * The popover is rendered through a portal into `document.body` and positioned
 * with `position: fixed` relative to the trigger's bounding box. This is the
 * key to it never being clipped: any ancestor with `overflow` set (e.g. the
 * scrollable Post Scorecard table) would otherwise cut off an in-flow
 * absolutely-positioned popover. Portaling moves it out of that subtree
 * entirely so no ancestor overflow can affect it.
 */
export default function InfoTooltip({ text, label }: InfoTooltipProps) {
  const [open, setOpen] = useState(false);
  const [mounted, setMounted] = useState(false);
  const [position, setPosition] = useState<TooltipPosition | null>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const id = useId();

  // The portal targets document.body, which only exists in the browser. Gate
  // the portal on a post-mount flag so a server render (or pre-hydration pass)
  // never touches document. This is the real SSR guard; "use client" alone does
  // not prevent this component from being rendered during SSR by a parent.
  useEffect(() => {
    // Post-mount SSR guard flag; must flip exactly once after hydration.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setMounted(true);
  }, []);

  // Clear the measured position on close so a stale (possibly off-layout)
  // position can never flash on the next open before useLayoutEffect re-measures.
  const close = useCallback(() => {
    setOpen(false);
    setPosition(null);
  }, []);

  // Measure the trigger and place the popover centered above it, in viewport
  // coordinates. Recomputed every time it opens so scroll/layout shifts since
  // the last open are accounted for.
  const updatePosition = useCallback(() => {
    const trigger = triggerRef.current;
    if (!trigger) return;
    const rect = trigger.getBoundingClientRect();
    setPosition({
      top: rect.top - TOOLTIP_GAP,
      left: rect.left + rect.width / 2,
    });
  }, []);

  // useLayoutEffect so the position is set before paint, avoiding a flash at
  // the top-left corner before the first measurement lands.
  useLayoutEffect(() => {
    if (open) updatePosition();
  }, [open, updatePosition]);

  return (
    <span className="relative inline-flex items-center">
      <button
        ref={triggerRef}
        type="button"
        aria-label={label ?? "More information"}
        aria-describedby={open ? id : undefined}
        onMouseEnter={() => setOpen(true)}
        onMouseLeave={close}
        onFocus={() => setOpen(true)}
        onBlur={close}
        onPointerDown={(e) => {
          // On touch (no hover), a tap fires focus THEN click. If we toggled in
          // onClick, focus would open and the click would immediately close it,
          // so a single tap would show nothing. Instead we suppress the implicit
          // focus on pointer-down and toggle here, giving a clean tap-to-toggle
          // without fighting the focus handler. Mouse hover/keyboard focus paths
          // are unaffected. preventDefault keeps focus off so onBlur won't double-fire.
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
      {open &&
        mounted &&
        createPortal(
          <span
            id={id}
            role="tooltip"
            className="fixed -translate-x-1/2 -translate-y-full z-50 w-max max-w-[280px] px-2.5 py-1.5 rounded-md text-[11px] font-normal leading-snug pointer-events-none shadow-lg flex flex-col gap-0.5"
            style={{
              top: position?.top ?? 0,
              left: position?.left ?? 0,
              // Keep it offscreen-invisible until the first measurement lands,
              // so it never flashes at 0,0.
              visibility: position ? "visible" : "hidden",
              background: "var(--chart-tooltip-bg)",
              color: "var(--chart-tooltip-text)",
              border: "1px solid var(--border)",
              whiteSpace: "normal",
            }}
          >
            {/* Split on "•" so component breakdowns render as one line per item;
                plain tooltips (no bullets) render as a single line. */}
            {renderTooltipLines(text)}
          </span>,
          document.body,
        )}
    </span>
  );
}
