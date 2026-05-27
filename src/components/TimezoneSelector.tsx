"use client";

import { TIMEZONE_PRESETS } from "@/lib/utils";

interface TimezoneSelectorProps {
  value: string;
  onChange: (tz: string) => void;
}

/**
 * Dropdown for the dashboard's display timezone. Affects every component
 * that calls formatLocalDate / formatLocalDateTime / hourOfDayLocal /
 * dayOfWeekLocal. The selection is persisted via useTimezone hook.
 */
export default function TimezoneSelector({
  value,
  onChange,
}: TimezoneSelectorProps) {
  return (
    <select
      value={value}
      onChange={(e) => onChange(e.target.value)}
      className="text-xs rounded px-2 py-1 border cursor-pointer outline-none"
      style={{
        background: "var(--bg-secondary)",
        color: "var(--text-primary)",
        borderColor: "var(--border)",
      }}
      aria-label="Display timezone"
      title="Display timezone — affects all timestamps in the dashboard"
    >
      {TIMEZONE_PRESETS.map((p) => (
        <option key={p.value} value={p.value}>
          TZ: {p.label}
        </option>
      ))}
    </select>
  );
}
