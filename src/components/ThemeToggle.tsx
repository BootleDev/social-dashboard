"use client";

import { useEffect, useState } from "react";
import { useTheme } from "next-themes";

type Mode = "light" | "dark" | "system";

const MODES: { key: Mode; label: string; glyph: string }[] = [
  { key: "light", label: "Light", glyph: "☀️" },
  { key: "dark", label: "Dark", glyph: "\u{1F319}" },
  { key: "system", label: "System", glyph: "\u{1F5A5}️" },
];

/**
 * Three-way light / dark / system theme switcher. Renders a small segmented
 * control in the dashboard header. The active mode is whichever `theme` the
 * user picked ("system" stays "system" — we do not collapse it to the resolved
 * value, so the choice survives reloads via next-themes' localStorage).
 *
 * Gated on `mounted` because `theme` is only known client-side; rendering it
 * during SSR would cause a hydration mismatch. A neutral placeholder keeps the
 * header layout stable until mount.
 */
export default function ThemeToggle() {
  const { theme, setTheme } = useTheme();
  const [mounted, setMounted] = useState(false);

  // Post-mount SSR guard flag; must flip exactly once after hydration.
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => setMounted(true), []);

  if (!mounted) {
    return (
      <div
        className="flex gap-1 rounded-lg p-1"
        style={{ background: "var(--bg-secondary)" }}
        aria-hidden
      >
        {MODES.map((m) => (
          <span
            key={m.key}
            className="px-2 py-1.5 rounded-md text-xs select-none opacity-0"
          >
            {m.glyph}
          </span>
        ))}
      </div>
    );
  }

  const current = (theme as Mode) ?? "system";

  return (
    <div
      className="flex gap-1 rounded-lg p-1"
      style={{ background: "var(--bg-secondary)" }}
      role="radiogroup"
      aria-label="Theme"
    >
      {MODES.map((m) => {
        const active = current === m.key;
        return (
          <button
            key={m.key}
            type="button"
            role="radio"
            aria-checked={active}
            title={m.label}
            onClick={() => setTheme(m.key)}
            className="px-2 py-1.5 rounded-md text-xs font-medium transition-colors cursor-pointer"
            style={{
              background: active ? "var(--brand)" : "transparent",
              color: active ? "#fff" : "var(--text-secondary)",
            }}
          >
            <span aria-hidden>{m.glyph}</span>
            <span className="sr-only">{m.label}</span>
          </button>
        );
      })}
    </div>
  );
}
