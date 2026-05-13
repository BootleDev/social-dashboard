"use client";

import { useState, useEffect, useCallback } from "react";
import { str, num } from "@/lib/utils";
import { toPost } from "@/lib/types";
import type { AirtableRecord } from "@/lib/utils";

const HOOK_TYPES = ["Question", "Bold claim", "Curiosity gap", "Pain point", "Visual-only", "None"];
const VO_TYPES = ["Original voice", "AI", "Text-only", "Music only"];
const CTA_TYPES = ["Link in bio", "Comment", "Save", "Visit website", "Direct", "None"];
const VISUAL_STYLES = ["Lifestyle", "Product-only", "UGC", "Aesthetic flat lay", "Tutorial"];
const SETTINGS = ["Outdoors", "Home", "Urban", "Studio"];
const CONTENT_PILLARS = ["Sustainability", "Modularity", "Design", "Drink recipe", "Lifestyle"];

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
}: {
  record: AirtableRecord;
  onApproved: (id: string) => void;
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
        <div className="space-y-1 flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <span
              className="text-xs px-1.5 py-0.5 rounded capitalize"
              style={{
                background: "var(--bg-secondary)",
                color: "var(--text-secondary)",
              }}
            >
              {post.platform}
            </span>
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

  const fetchPosts = useCallback(() => {
    setLoading(true);
    setError("");
    fetch("/api/airtable?table=posts")
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
  }

  const unapproved = records.filter(
    (r) =>
      !approved.has(r.id) &&
      str(r.fields["Tagging Status"]) !== "Approved",
  );

  const approvedCount = records.filter(
    (r) => str(r.fields["Tagging Status"]) === "Approved",
  ).length + approved.size;

  const total = records.length;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-base font-semibold">Tag Posts</h2>
          <p className="text-xs mt-0.5" style={{ color: "var(--text-secondary)" }}>
            {loading
              ? "Loading…"
              : `${unapproved.length} to tag, ${approvedCount} / ${total} approved`}
          </p>
        </div>
        <button
          onClick={fetchPosts}
          className="text-[10px] px-2 py-1 rounded transition-colors hover:bg-white/10 cursor-pointer"
          style={{ color: "var(--text-secondary)", border: "1px solid var(--border)" }}
        >
          Refresh
        </button>
      </div>

      {error && (
        <div className="rounded-xl p-4 border border-red-500/30 bg-red-500/10 text-red-400 text-sm">
          {error}
        </div>
      )}

      {!loading && unapproved.length === 0 && !error && (
        <div
          className="rounded-xl p-8 text-center text-sm"
          style={{ background: "var(--bg-card)", border: "1px solid var(--border)" }}
        >
          All posts tagged.
        </div>
      )}

      <div className="space-y-4">
        {unapproved.map((r) => (
          <PostTagCard key={r.id} record={r} onApproved={handleApproved} />
        ))}
      </div>
    </div>
  );
}
