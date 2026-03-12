"use client";

import { useState, useRef, useEffect } from "react";

export interface DateRange {
  start: string | null;
  end: string | null;
  label: string;
}

interface Props {
  value: DateRange;
  onChange: (range: DateRange) => void;
}

const PRESETS: { label: string; days: number | null }[] = [
  { label: "All Time", days: null },
  { label: "Last 90 days", days: 90 },
  { label: "Last 30 days", days: 30 },
  { label: "Last 14 days", days: 14 },
  { label: "Last 7 days", days: 7 },
];

function daysAgo(n: number): string {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() - n);
  return d.toISOString().split("T")[0];
}

export default function DateRangeFilter({ value, onChange }: Props) {
  const [open, setOpen] = useState(false);
  const [customStart, setCustomStart] = useState("");
  const [customEnd, setCustomEnd] = useState("");
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, []);

  function selectPreset(preset: (typeof PRESETS)[number]) {
    if (preset.days === null) {
      onChange({ start: null, end: null, label: preset.label });
    } else {
      onChange({
        start: daysAgo(preset.days),
        end: new Date().toISOString().split("T")[0],
        label: preset.label,
      });
    }
    setOpen(false);
  }

  function applyCustom() {
    if (customStart && customEnd) {
      const start = customStart < customEnd ? customStart : customEnd;
      const end = customStart < customEnd ? customEnd : customStart;
      onChange({
        start,
        end,
        label: `${start} to ${end}`,
      });
      setOpen(false);
    }
  }

  return (
    <div ref={ref} className="relative">
      <button
        onClick={() => setOpen(!open)}
        className="flex items-center gap-2 px-3 py-1.5 rounded-lg text-xs font-medium transition-colors"
        style={{
          background: "var(--bg-secondary)",
          color: "var(--text-secondary)",
          border: "1px solid var(--border)",
        }}
      >
        <svg
          width="14"
          height="14"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          aria-hidden="true"
        >
          <rect x="3" y="4" width="18" height="18" rx="2" ry="2" />
          <line x1="16" y1="2" x2="16" y2="6" />
          <line x1="8" y1="2" x2="8" y2="6" />
          <line x1="3" y1="10" x2="21" y2="10" />
        </svg>
        {value.label}
        <svg
          width="10"
          height="10"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="3"
          aria-hidden="true"
        >
          <polyline points="6 9 12 15 18 9" />
        </svg>
      </button>

      {open && (
        <div
          className="absolute right-0 top-full mt-1 z-50 rounded-xl p-3 shadow-xl min-w-[220px]"
          style={{
            background: "var(--bg-card)",
            border: "1px solid var(--border)",
          }}
        >
          <div className="space-y-1 mb-3">
            {PRESETS.map((p) => (
              <button
                key={p.label}
                onClick={() => selectPreset(p)}
                className="w-full text-left px-3 py-1.5 rounded-md text-xs transition-colors hover:bg-white/10"
                style={{
                  color:
                    value.label === p.label
                      ? "var(--accent-blue)"
                      : "var(--text-primary)",
                  fontWeight: value.label === p.label ? 600 : 400,
                }}
              >
                {p.label}
              </button>
            ))}
          </div>

          <div
            className="border-t pt-3 space-y-2"
            style={{ borderColor: "var(--border)" }}
          >
            <p
              className="text-[10px] font-medium uppercase tracking-wider"
              style={{ color: "var(--text-secondary)" }}
            >
              Custom Range
            </p>
            <div className="flex gap-2">
              <input
                type="date"
                value={customStart}
                onChange={(e) => setCustomStart(e.target.value)}
                className="flex-1 rounded-md px-2 py-1 text-xs"
                style={{
                  background: "var(--bg-secondary)",
                  color: "var(--text-primary)",
                  border: "1px solid var(--border)",
                }}
              />
              <input
                type="date"
                value={customEnd}
                onChange={(e) => setCustomEnd(e.target.value)}
                className="flex-1 rounded-md px-2 py-1 text-xs"
                style={{
                  background: "var(--bg-secondary)",
                  color: "var(--text-primary)",
                  border: "1px solid var(--border)",
                }}
              />
            </div>
            <button
              onClick={applyCustom}
              disabled={!customStart || !customEnd}
              className="w-full py-1.5 rounded-md text-xs font-medium text-white disabled:opacity-40 transition-colors"
              style={{ background: "var(--accent-blue)" }}
            >
              Apply
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
