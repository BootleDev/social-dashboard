"use client";

/**
 * Shared presentational primitives for the Paid tab — formatters, the card
 * style, and the small labelled-value / input / table-row components. Extracted
 * from PaidPanel.tsx to keep that container under the project's 800-line cap and
 * give each piece a focused home. No business logic lives here.
 */

import type { Projection } from "@/lib/adScenario";
import InfoTooltip from "../InfoTooltip";

/** Card surface shared by every Paid section. */
export const card: React.CSSProperties = {
  background: "var(--bg-card)",
  border: "1px solid var(--border)",
};

// ----- formatters: render undefined as "—" -----

export const eur = (v: number | undefined) =>
  v === undefined ? "—" : `€${v.toLocaleString("en-IE", { maximumFractionDigits: 2 })}`;
export const int = (v: number | undefined) =>
  v === undefined ? "—" : Math.round(v).toLocaleString("en-IE");
export const pct = (v: number | undefined, d = 2) =>
  v === undefined ? "—" : `${(v * 100).toFixed(d)}%`;
export const ratio = (v: number | undefined) => (v === undefined ? "—" : v.toFixed(2));
/** A bare percent number for a percent-unit input placeholder: 0.0162 → "1.62". */
export const pctPlain = (v: number | undefined, d = 2) =>
  v === undefined ? "" : (v * 100).toFixed(d);

// ----- components -----

/** A labelled baseline metric with a confidence chip, optional sub-line + tooltip. */
export function Metric({
  label,
  value,
  conf,
  sub,
  tip,
}: {
  label: string;
  value: string;
  conf: string;
  sub?: string;
  tip?: string;
}) {
  return (
    <div>
      <div className="text-xs inline-flex items-center gap-1" style={{ color: "var(--text-secondary)" }}>
        {label} {conf !== "ok" && <span title="low / no volume">·{conf}</span>}
        {tip && <InfoTooltip text={tip} label={`What is ${label}?`} />}
      </div>
      <div className="text-lg font-semibold">{value}</div>
      {sub && (
        <div className="text-[11px]" style={{ color: "var(--text-secondary)" }}>
          {sub}
        </div>
      )}
    </div>
  );
}

/** A labelled form control with an optional tooltip on the label. */
export function Field({
  label,
  children,
  tip,
}: {
  label: string;
  children: React.ReactNode;
  tip?: string;
}) {
  return (
    <label className="block">
      <span className="text-xs mb-1 inline-flex items-center gap-1" style={{ color: "var(--text-secondary)" }}>
        {label}
        {tip && <InfoTooltip text={tip} label={`What is ${label}?`} />}
      </span>
      {children}
    </label>
  );
}

/** A numeric input wrapped in a Field. */
export function NumField({
  label,
  value,
  onChange,
  step,
  min,
  max,
  tip,
}: {
  label: string;
  value: number;
  onChange: (v: number) => void;
  step: number;
  min?: number;
  max?: number;
  tip?: string;
}) {
  return (
    <Field label={label} tip={tip}>
      <input
        type="number"
        value={value}
        step={step}
        min={min}
        max={max}
        onChange={(e) => onChange(Number(e.target.value))}
        className="w-full rounded px-2 py-1 text-sm"
        style={{ background: "var(--bg-primary)", border: "1px solid var(--border)" }}
      />
    </Field>
  );
}

/** A free-text input (used for optional overrides) wrapped in a Field. */
export function TextField({
  label,
  value,
  onChange,
  placeholder,
  tip,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  tip?: string;
}) {
  return (
    <Field label={label} tip={tip}>
      <input
        type="text"
        value={value}
        placeholder={placeholder}
        onChange={(e) => onChange(e.target.value)}
        className="w-full rounded px-2 py-1 text-sm"
        style={{ background: "var(--bg-primary)", border: "1px solid var(--border)" }}
      />
    </Field>
  );
}

/** One metric row of the low/expected/high projection table. */
export function Row({
  label,
  pick,
  r,
  emphasize,
  tip,
}: {
  label: string;
  pick: (p: Projection) => string;
  r: { low: Projection; expected: Projection; high: Projection };
  emphasize?: boolean;
  tip?: string;
}) {
  return (
    <tr style={{ borderTop: "1px solid var(--border)" }}>
      <td className="py-1.5 pr-4" style={{ color: "var(--text-secondary)" }}>
        <span className="inline-flex items-center gap-1">
          {label}
          {tip && <InfoTooltip text={tip} label={`What is ${label}?`} />}
        </span>
      </td>
      <td className="py-1.5 pr-4">{pick(r.low)}</td>
      <td className={`py-1.5 pr-4 ${emphasize ? "font-semibold" : ""}`}>{pick(r.expected)}</td>
      <td className="py-1.5 pr-4">{pick(r.high)}</td>
    </tr>
  );
}

/** A small labelled break-even figure with an explanatory tooltip. */
export function Callout({ label, value, hint }: { label: string; value: string; hint: string }) {
  return (
    <div className="rounded-lg p-3" style={{ background: "var(--bg-primary)" }}>
      <div className="text-xs inline-flex items-center gap-1" style={{ color: "var(--text-secondary)" }}>
        {label}
        <InfoTooltip text={hint} label={`What is ${label}?`} />
      </div>
      <div className="text-lg font-semibold">{value}</div>
    </div>
  );
}
