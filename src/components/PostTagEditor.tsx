"use client";

import { useState } from "react";

/**
 * Single-post inline tag editor. Used inside PostDrilldownPanel. Each tag
 * field becomes a dropdown (single-select choices from Airtable schema) or
 * a free-text input for tag fields without a fixed choice list. Changes
 * fire an optimistic update via the supplied `onChange` and POST to
 * /api/posts/[id] under the hood. Save state is reflected per-field
 * (idle / saving / error) so the user sees what happened.
 */

interface PostTagEditorProps {
  recordId: string;
  /** Current values per tag field. Empty string means unset. */
  values: Record<string, string>;
  /** Called when a value is saved successfully so the parent can reflect
   *  the new value in its own state. */
  onSaved: (field: string, value: string) => void;
}

interface TagFieldConfig {
  /** Airtable field name */
  name: string;
  /** Short label shown above the input */
  label: string;
  /** undefined = free text; array = single-select choices */
  choices?: readonly string[];
}

// Mirrors EDITABLE_FIELDS in /api/posts/[id]/route.ts and the Airtable
// schema. If you add a tag here, add it to the server whitelist too.
export const TAG_FIELD_CONFIG: readonly TagFieldConfig[] = [
  { name: "Hook Type", label: "Hook" },
  { name: "Content Theme", label: "Theme" },
  {
    name: "Content Pillar",
    label: "Pillar",
    choices: [
      "Sustainability",
      "Modularity",
      "Design",
      "Drink recipe",
      "Lifestyle",
    ],
  },
  {
    name: "CTA Type",
    label: "CTA",
    choices: [
      "Link in bio",
      "Comment",
      "Save",
      "Visit website",
      "Direct",
      "None",
    ],
  },
  {
    name: "Visual Style",
    label: "Visual",
    choices: [
      "Lifestyle",
      "Product-only",
      "UGC",
      "Aesthetic flat lay",
      "Tutorial",
    ],
  },
  {
    name: "Setting",
    label: "Setting",
    choices: ["Outdoors", "Home", "Urban", "Studio"],
  },
  {
    name: "VO Type",
    label: "VO",
    choices: ["Original voice", "AI", "Text-only", "Music only"],
  },
];

type SaveState = "idle" | "saving" | "error";

export default function PostTagEditor({
  recordId,
  values,
  onSaved,
}: PostTagEditorProps) {
  // Per-field save state so two simultaneous edits stay independent.
  const [state, setState] = useState<Record<string, SaveState>>({});
  const [errors, setErrors] = useState<Record<string, string>>({});

  const save = async (field: string, newValue: string) => {
    if (newValue === (values[field] ?? "")) return;
    setState((s) => ({ ...s, [field]: "saving" }));
    setErrors((e) => ({ ...e, [field]: "" }));
    try {
      const res = await fetch(`/api/posts/${recordId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ fields: { [field]: newValue } }),
      });
      if (!res.ok) {
        const data = await res
          .json()
          .catch(() => ({ error: `HTTP ${res.status}` }));
        throw new Error(data.error || `HTTP ${res.status}`);
      }
      setState((s) => ({ ...s, [field]: "idle" }));
      onSaved(field, newValue);
    } catch (err) {
      const message = err instanceof Error ? err.message : "Save failed";
      setState((s) => ({ ...s, [field]: "error" }));
      setErrors((e) => ({ ...e, [field]: message }));
    }
  };

  return (
    <div className="grid grid-cols-2 gap-1.5 mt-2">
      {TAG_FIELD_CONFIG.map((cfg) => {
        const current = values[cfg.name] ?? "";
        const status = state[cfg.name] ?? "idle";
        const error = errors[cfg.name];
        return (
          <label
            key={cfg.name}
            className="flex flex-col gap-0.5"
            title={error || undefined}
          >
            <span
              className="text-[10px] uppercase tracking-wide flex items-center justify-between"
              style={{ color: "var(--text-secondary)" }}
            >
              <span>{cfg.label}</span>
              {status === "saving" && (
                <span className="opacity-60 normal-case">saving…</span>
              )}
              {status === "error" && (
                <span style={{ color: "var(--danger)" }} className="normal-case">
                  retry
                </span>
              )}
            </span>
            {cfg.choices ? (
              <select
                value={current}
                onChange={(e) => save(cfg.name, e.target.value)}
                disabled={status === "saving"}
                className="text-[11px] px-1.5 py-0.5 rounded outline-none cursor-pointer"
                style={{
                  background: "var(--bg-secondary)",
                  border: `1px solid ${status === "error" ? "var(--danger)" : "var(--border)"}`,
                  color: "var(--text-primary)",
                }}
              >
                <option value="">—</option>
                {cfg.choices.map((c) => (
                  <option key={c} value={c}>
                    {c}
                  </option>
                ))}
              </select>
            ) : (
              <input
                type="text"
                defaultValue={current}
                onBlur={(e) => save(cfg.name, e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") (e.target as HTMLInputElement).blur();
                }}
                disabled={status === "saving"}
                placeholder="—"
                className="text-[11px] px-1.5 py-0.5 rounded outline-none"
                style={{
                  background: "var(--bg-secondary)",
                  border: `1px solid ${status === "error" ? "var(--danger)" : "var(--border)"}`,
                  color: "var(--text-primary)",
                }}
              />
            )}
          </label>
        );
      })}
    </div>
  );
}
