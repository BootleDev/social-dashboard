"use client";

import { useState, useEffect, useCallback, useMemo } from "react";
import { str, num } from "@/lib/utils";
import { toPost } from "@/lib/types";
import type { AirtableRecord } from "@/lib/utils";

const HOOK_TYPES = [
  "Statement",
  "Question",
  "Story",
  "Educational",
  "Curiosity gap",
  "Visual-only",
  "Bold claim",
  "Pain point",
  "List",
  "Steps",
];
const CONTENT_THEMES = [
  "Recipes",
  "Product",
  "UGC",
  "Lifestyle",
  "Behind-the-Scenes",
  "Education",
  "Sustainability",
];
const VO_TYPES = ["Original voice", "AI", "Text-only", "Music only"];
const CTA_TYPES = ["Link in bio", "Comment", "Save", "Visit website", "Direct", "None"];
const VISUAL_STYLES = ["Lifestyle", "Product-only", "UGC", "Aesthetic flat lay", "Tutorial"];
const SETTINGS = ["Outdoors", "Home", "Urban", "Studio"];
const CONTENT_PILLARS = ["Sustainability", "Modularity", "Design", "Drink recipe"];

type StatusFilter = "draft" | "untagged" | "all";

interface DraftState {
  hookPresent: boolean;
  hookType: string;
  hookText: string;
  voType: string;
  ctaType: string;
  onScreenText: boolean;
  visualStyle: string;
  setting: string;
  contentPillar: string;
  contentTheme: string;
  talentPresent: boolean;
}

function initialDraft(r: AirtableRecord): DraftState {
  const p = toPost(r);
  return {
    hookPresent: p.hookPresent || Boolean(p.draftHookType),
    hookType: p.hookType || p.draftHookType,
    hookText: p.hookText,
    voType: p.voType || p.draftVoType,
    ctaType: p.ctaType || p.draftCtaType,
    onScreenText: p.onScreenText,
    visualStyle: p.visualStyle || p.draftVisualStyle,
    setting: p.setting || p.draftSetting,
    contentPillar: p.contentPillar || p.draftContentPillar,
    contentTheme: p.contentTheme,
    talentPresent: p.talentPresent,
  };
}

function SelectField({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: string;
  options: string[];
  onChange: (v: string) => void;
}) {
  return (
    <div className="flex flex-col gap-0.5">
      <label className="text-[10px]" style={{ color: "var(--text-secondary)" }}>
        {label}
      </label>
      <select
        className="text-xs rounded px-2 py-1 border outline-none cursor-pointer"
        style={{
          background: "var(--bg-secondary)",
          color: "var(--text-primary)",
          borderColor: "var(--border)",
        }}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        aria-label={label}
      >
        <option value="">—</option>
        {options.map((o) => (
          <option key={o} value={o}>
            {o}
          </option>
        ))}
      </select>
    </div>
  );
}

function CheckField({
  label,
  value,
  onChange,
}: {
  label: string;
  value: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <div className="flex items-center gap-1.5">
      <input
        type="checkbox"
        id={`check-${label}`}
        checked={value}
        onChange={(e) => onChange(e.target.checked)}
        className="cursor-pointer"
        aria-label={label}
      />
      <label
        htmlFor={`check-${label}`}
        className="text-xs cursor-pointer"
        style={{ color: "var(--text-secondary)" }}
      >
        {label}
      </label>
    </div>
  );
}

function PostTagCard({
  record,
  onApproved,
  selected,
  onSelectChange,
}: {
  record: AirtableRecord;
  onApproved: (id: string) => void;
  selected: boolean;
  onSelectChange: (id: string, selected: boolean) => void;
}) {
  const [draft, setDraft] = useState<DraftState>(() => initialDraft(record));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  const post = toPost(record);
  const date = post.publishedAt.split("T")[0];
  const caption = post.caption.slice(0, 120);

  function update<K extends keyof DraftState>(key: K, value: DraftState[K]) {
    setDraft((prev) => ({ ...prev, [key]: value }));
  }

  async function approve() {
    setSaving(true);
    setError("");
    try {
      const res = await fetch("/api/airtable/update-post", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          id: record.id,
          fields: {
            "Hook Present": draft.hookPresent,
            "Hook Type": draft.hookType || null,
            "Hook Text": draft.hookText || null,
            "VO Type": draft.voType || null,
            "CTA Type": draft.ctaType || null,
            "On-Screen Text": draft.onScreenText,
            "Visual Style": draft.visualStyle || null,
            Setting: draft.setting || null,
            "Content Pillar": draft.contentPillar || null,
            "Content Theme": draft.contentTheme || null,
            "Talent Present": draft.talentPresent,
            "Tagging Status": "Approved",
          },
        }),
      });
      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error ?? `HTTP ${res.status}`);
      }
      onApproved(record.id);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unknown error");
    } finally {
      setSaving(false);
    }
  }

  async function skip() {
    setSaving(true);
    setError("");
    try {
      await fetch("/api/airtable/update-post", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          id: record.id,
          fields: { "Tagging Status": "Draft" },
        }),
      });
    } catch {
      // Non-critical — just move on
    } finally {
      setSaving(false);
      onApproved(record.id);
    }
  }

  return (
    <div
      className="rounded-xl p-5 space-y-4"
      style={{ background: "var(--bg-card)", border: "1px solid var(--border)" }}
    >
      {/* Post header */}
      <div className="flex items-start justify-between gap-4">
        <div className="flex items-start gap-3 flex-1 min-w-0">
          <input
            type="checkbox"
            checked={selected}
            onChange={(e) => onSelectChange(record.id, e.target.checked)}
            className="mt-1 cursor-pointer"
            aria-label="Select for bulk approve"
          />
        <div className="space-y-1 flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span
              className="text-xs px-1.5 py-0.5 rounded capitalize"
              style={{
                background: "var(--bg-secondary)",
                color: "var(--text-secondary)",
              }}
            >
              {post.platform}
            </span>
            {str(record.fields["Tagging Status"]) && (
              <span
                className="text-[10px] px-1.5 py-0.5 rounded uppercase tracking-wide"
                style={{
                  background:
                    str(record.fields["Tagging Status"]) === "Draft"
                      ? "rgba(234, 179, 8, 0.15)"
                      : "var(--bg-secondary)",
                  color:
                    str(record.fields["Tagging Status"]) === "Draft"
                      ? "rgb(234, 179, 8)"
                      : "var(--text-secondary)",
                }}
              >
                {str(record.fields["Tagging Status"])}
              </span>
            )}
            <span className="text-xs" style={{ color: "var(--text-secondary)" }}>
              {date}
            </span>
            {post.postType && (
              <span className="text-xs" style={{ color: "var(--text-secondary)" }}>
                {post.postType}
              </span>
            )}
            {num(record.fields["Engagement Rate"]) > 0 && (
              <span className="text-xs text-green-400">
                {(num(record.fields["Engagement Rate"]) * 100).toFixed(2)}% ER
              </span>
            )}
          </div>
          <p className="text-sm leading-snug">{caption}{post.caption.length > 120 ? "…" : ""}</p>
        </div>
        </div>
        {post.mediaUrl && (
          <a
            href={post.mediaUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="text-xs shrink-0 underline"
            style={{ color: "var(--text-secondary)" }}
          >
            View
          </a>
        )}
      </div>

      {/* Tag fields */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
        <SelectField
          label="Hook Type"
          value={draft.hookType}
          options={HOOK_TYPES}
          onChange={(v) => update("hookType", v)}
        />
        <SelectField
          label="Content Theme"
          value={draft.contentTheme}
          options={CONTENT_THEMES}
          onChange={(v) => update("contentTheme", v)}
        />
        <SelectField
          label="VO Type"
          value={draft.voType}
          options={VO_TYPES}
          onChange={(v) => update("voType", v)}
        />
        <SelectField
          label="CTA Type"
          value={draft.ctaType}
          options={CTA_TYPES}
          onChange={(v) => update("ctaType", v)}
        />
        <SelectField
          label="Visual Style"
          value={draft.visualStyle}
          options={VISUAL_STYLES}
          onChange={(v) => update("visualStyle", v)}
        />
        <SelectField
          label="Setting"
          value={draft.setting}
          options={SETTINGS}
          onChange={(v) => update("setting", v)}
        />
        <SelectField
          label="Content Pillar"
          value={draft.contentPillar}
          options={CONTENT_PILLARS}
          onChange={(v) => update("contentPillar", v)}
        />
      </div>

      <div className="flex items-center gap-4 flex-wrap">
        <CheckField
          label="Hook Present"
          value={draft.hookPresent}
          onChange={(v) => update("hookPresent", v)}
        />
        <CheckField
          label="On-Screen Text"
          value={draft.onScreenText}
          onChange={(v) => update("onScreenText", v)}
        />
        <CheckField
          label="Talent Present"
          value={draft.talentPresent}
          onChange={(v) => update("talentPresent", v)}
        />
      </div>

      <div className="flex flex-col gap-0.5">
        <label
          className="text-[10px]"
          style={{ color: "var(--text-secondary)" }}
        >
          Hook Text (optional)
        </label>
        <input
          type="text"
          className="text-xs rounded px-2 py-1 border outline-none w-full"
          style={{
            background: "var(--bg-secondary)",
            color: "var(--text-primary)",
            borderColor: "var(--border)",
          }}
          value={draft.hookText}
          onChange={(e) => update("hookText", e.target.value)}
          placeholder="First line / first 3s of audio…"
          aria-label="Hook Text"
        />
      </div>

      {error && (
        <p className="text-xs text-red-400">{error}</p>
      )}

      {/* Actions */}
      <div className="flex items-center gap-2">
        <button
          onClick={approve}
          disabled={saving}
          className="px-4 py-1.5 rounded text-xs font-medium transition-colors disabled:opacity-50 cursor-pointer"
          style={{ background: "var(--accent-purple)", color: "#fff" }}
        >
          {saving ? "Saving…" : "Approve"}
        </button>
        <button
          onClick={skip}
          disabled={saving}
          className="px-3 py-1.5 rounded text-xs transition-colors hover:bg-white/10 disabled:opacity-50 cursor-pointer"
          style={{
            color: "var(--text-secondary)",
            border: "1px solid var(--border)",
          }}
        >
          Skip
        </button>
      </div>
    </div>
  );
}

export default function TaggingPage() {
  const [records, setRecords] = useState<AirtableRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [approved, setApproved] = useState<Set<string>>(new Set());
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("draft");
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [bulkApproving, setBulkApproving] = useState(false);
  const [bulkError, setBulkError] = useState("");

  const fetchPosts = useCallback((noCache = false) => {
    setLoading(true);
    setError("");
    const url = noCache
      ? "/api/airtable?table=posts&nocache=1"
      : "/api/airtable?table=posts";
    fetch(url)
      .then((res) => {
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        return res.json();
      })
      .then((d) => setRecords(d.records ?? []))
      .catch((err) => setError(err.message))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    fetchPosts();
  }, [fetchPosts]);

  function handleApproved(id: string) {
    setApproved((prev) => new Set([...prev, id]));
    setSelectedIds((prev) => {
      const next = new Set(prev);
      next.delete(id);
      return next;
    });
  }

  function handleSelectChange(id: string, selected: boolean) {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (selected) next.add(id);
      else next.delete(id);
      return next;
    });
  }

  const visibleRecords = useMemo(() => {
    return records.filter((r) => {
      if (approved.has(r.id)) return false;
      const status = str(r.fields["Tagging Status"]);
      if (status === "Approved") return false;
      if (statusFilter === "draft") return status === "Draft";
      if (statusFilter === "untagged") return status !== "Draft";
      return true;
    });
  }, [records, approved, statusFilter]);

  const approvedCount =
    records.filter((r) => str(r.fields["Tagging Status"]) === "Approved").length +
    approved.size;
  const total = records.length;

  const visibleSelectedCount = useMemo(
    () => visibleRecords.filter((r) => selectedIds.has(r.id)).length,
    [visibleRecords, selectedIds],
  );

  function toggleSelectAll() {
    if (visibleSelectedCount === visibleRecords.length) {
      // Deselect all visible
      setSelectedIds((prev) => {
        const next = new Set(prev);
        for (const r of visibleRecords) next.delete(r.id);
        return next;
      });
    } else {
      setSelectedIds((prev) => {
        const next = new Set(prev);
        for (const r of visibleRecords) next.add(r.id);
        return next;
      });
    }
  }

  async function bulkApprove() {
    if (selectedIds.size === 0) return;
    setBulkApproving(true);
    setBulkError("");
    const ids = Array.from(selectedIds);
    const failures: string[] = [];
    // Sequential to respect 10/min rate limit; bail on first failure-pattern
    for (const id of ids) {
      try {
        const res = await fetch("/api/airtable/update-post", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            id,
            fields: { "Tagging Status": "Approved" },
          }),
        });
        if (!res.ok) {
          const data = await res.json().catch(() => ({}));
          failures.push(`${id}: ${data.error ?? res.status}`);
          // If we hit rate limit, stop early — user can retry
          if (res.status === 429) break;
        } else {
          handleApproved(id);
        }
      } catch (err) {
        failures.push(`${id}: ${err instanceof Error ? err.message : "error"}`);
      }
    }
    setBulkApproving(false);
    if (failures.length > 0) {
      setBulkError(
        `${failures.length} of ${ids.length} failed. First: ${failures[0]}`,
      );
    }
  }

  const filterLabel: Record<StatusFilter, string> = {
    draft: "Draft only",
    untagged: "Untagged only",
    all: "All not-Approved",
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between gap-4 flex-wrap">
        <div>
          <h2 className="text-base font-semibold">Review Queue</h2>
          <p className="text-xs mt-0.5" style={{ color: "var(--text-secondary)" }}>
            {loading
              ? "Loading…"
              : `${visibleRecords.length} showing (${filterLabel[statusFilter]}), ${approvedCount} / ${total} approved`}
          </p>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <select
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value as StatusFilter)}
            className="text-xs rounded px-2 py-1 border outline-none cursor-pointer"
            style={{
              background: "var(--bg-secondary)",
              color: "var(--text-primary)",
              borderColor: "var(--border)",
            }}
            aria-label="Status filter"
          >
            <option value="draft">Draft only</option>
            <option value="untagged">Untagged only</option>
            <option value="all">All not-Approved</option>
          </select>
          <button
            onClick={() => fetchPosts(true)}
            className="text-[10px] px-2 py-1 rounded transition-colors hover:bg-white/10 cursor-pointer"
            style={{
              color: "var(--text-secondary)",
              border: "1px solid var(--border)",
            }}
          >
            Refresh
          </button>
        </div>
      </div>

      {visibleRecords.length > 0 && (
        <div
          className="flex items-center justify-between gap-4 rounded-lg px-3 py-2 sticky top-0 z-10"
          style={{
            background: "var(--bg-card)",
            border: "1px solid var(--border)",
          }}
        >
          <label className="flex items-center gap-2 text-xs cursor-pointer">
            <input
              type="checkbox"
              checked={
                visibleSelectedCount > 0 &&
                visibleSelectedCount === visibleRecords.length
              }
              ref={(el) => {
                if (el)
                  el.indeterminate =
                    visibleSelectedCount > 0 &&
                    visibleSelectedCount < visibleRecords.length;
              }}
              onChange={toggleSelectAll}
              aria-label="Select all visible"
            />
            <span style={{ color: "var(--text-secondary)" }}>
              {visibleSelectedCount === 0
                ? "Select all visible"
                : `${visibleSelectedCount} selected`}
            </span>
          </label>
          <button
            onClick={bulkApprove}
            disabled={visibleSelectedCount === 0 || bulkApproving}
            className="px-3 py-1 rounded text-xs font-medium transition-colors disabled:opacity-40 cursor-pointer"
            style={{ background: "var(--accent-purple)", color: "#fff" }}
          >
            {bulkApproving
              ? "Approving…"
              : `Approve ${visibleSelectedCount} selected`}
          </button>
        </div>
      )}

      {bulkError && (
        <div className="rounded-xl p-3 border border-red-500/30 bg-red-500/10 text-red-400 text-xs">
          {bulkError}
        </div>
      )}

      {error && (
        <div className="rounded-xl p-4 border border-red-500/30 bg-red-500/10 text-red-400 text-sm">
          {error}
        </div>
      )}

      {!loading && visibleRecords.length === 0 && !error && (
        <div
          className="rounded-xl p-8 text-center text-sm"
          style={{ background: "var(--bg-card)", border: "1px solid var(--border)" }}
        >
          No posts match the current filter.
        </div>
      )}

      <div className="space-y-4">
        {visibleRecords.map((r) => (
          <PostTagCard
            key={r.id}
            record={r}
            onApproved={handleApproved}
            selected={selectedIds.has(r.id)}
            onSelectChange={handleSelectChange}
          />
        ))}
      </div>
    </div>
  );
}
