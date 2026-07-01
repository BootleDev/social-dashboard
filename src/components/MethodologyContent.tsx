"use client";

import { useEffect, useMemo, useState } from "react";
import { getPlatformConfig } from "@/lib/platforms";
import type { AirtableRecord } from "@/lib/utils";
import { str } from "@/lib/utils";

/**
 * /dashboard/methodology — full data-lineage transparency for every account
 * metric on the dashboard (WEBDEV-146). Built for two audiences at once:
 * ELT reads the plain-language layer and the live status; data/analytics
 * engineers read the per-metric origin, grain, provenance, and aggregation.
 *
 * Design principle: derive from LIVE data + a single typed config instead of
 * hardcoding prose that goes stale. The "Live data status" panel reads the same
 * /api/airtable feed the dashboard uses and reports what is actually in the
 * Account Daily Facts table right now (latest date, settle split, the Source
 * tags in use). The METRIC_LINEAGE config below is the one place the per-metric
 * model is described; everything renders from it.
 *
 * If the data model changes, edit METRIC_LINEAGE / SOURCE_VOCAB here and the
 * matching constants in src/lib/airtable.ts — those are the only two sources.
 */

// ---------------------------------------------------------------------------
// Single source of truth for the per-metric lineage model.
// ---------------------------------------------------------------------------

const ACCOUNT_DAILY_FACTS_TABLE = "tblgKAMI1pF3FjQGo";
const POST_DAILY_FACTS_TABLE = "tblz1pSPb5ByXZMHe";

type Aggregation = "window_sum" | "period_snapshot" | "latest_snapshot";

interface PlatformOrigin {
  platform: "instagram" | "facebook" | "pinterest";
  /** The literal API field this value comes from, or null if the platform does not report it. */
  apiField: string | null;
  /** The Source/provenance tag written for this platform+metric. */
  source: string;
  /** Plain-language note shown to readers; for absences, why there is no value. */
  note: string;
}

interface MetricLineage {
  metric: string;
  /** The Airtable column the value lands in. */
  column: string;
  grain: string;
  aggregation: Aggregation;
  /** One-line, audience-neutral description of what the number means. */
  summary: string;
  origins: PlatformOrigin[];
}

const AGG_LABEL: Record<Aggregation, string> = {
  window_sum: "Summed over the selected date window",
  period_snapshot: "Platform-reported period total (never summed across days)",
  latest_snapshot: "Most recent value (a point-in-time snapshot)",
};

const SOURCE_VOCAB: { tag: string; meaning: string }[] = [
  {
    tag: "daily_real",
    meaning:
      "A real same-day measurement the platform reported for that date. Counts in window sums.",
  },
  {
    tag: "pin_sum",
    meaning:
      "Pinterest only: the account figure is defined as the sum of that day's per-pin impressions, because Pinterest exposes no deduplicated account reach. A real distribution figure, tagged distinctly so it is never mistaken for a directly-measured account number.",
  },
  {
    tag: "daily_proxy",
    meaning:
      "Facebook account reach only, from 2026-06-20: the Graph API publishes no deduplicated FB account reach, so reach is proxied by page_total_media_view_unique (unique users who viewed page content — the same metric behind FB impressions). Counted in window sums and tagged distinctly so it is never mistaken for a directly-measured dedup reach. FB reach therefore tracks FB impressions by construction.",
  },
  {
    tag: "null",
    meaning:
      "No honest value exists for that metric on that day. The dashboard shows an em-dash, never a zero or a stand-in.",
  },
  {
    tag: "period_aggregate",
    meaning:
      "A rolling window total the platform only exposes as an aggregate (e.g. Instagram's 30-day figures). Written to the newest row only and never summed across days.",
  },
  {
    tag: "pending → settled",
    meaning:
      "data_status. Recent days arrive pending and settle over ~1-2 days as platforms finalize counts. Each run re-fetches the trailing window so pending days self-correct.",
  },
];

const METRIC_LINEAGE: MetricLineage[] = [
  {
    metric: "Reach",
    column: "Reach",
    grain: "Account · per day",
    aggregation: "window_sum",
    summary: "Unique accounts reached. Summed per real-measurement day over the window.",
    origins: [
      {
        platform: "instagram",
        apiField: "reach (period=day), Graph API v22.0",
        source: "daily_real",
        note: "Real per-day account reach, measured directly.",
      },
      {
        platform: "facebook",
        apiField: "page_total_media_view_unique (v22.0, page token) — proxy",
        source: "daily_proxy",
        note: "Facebook's Graph API v22.0 reports no deduplicated account reach. Since 2026-06-20 we proxy it with page_total_media_view_unique (unique users who viewed page content — the same metric behind FB impressions), disclosed as a proxy and counted in sums. FB reach therefore tracks FB impressions; it is not a directly-measured dedup reach.",
      },
      {
        platform: "pinterest",
        apiField: "sum of per-pin IMPRESSION (v5 pin analytics)",
        source: "pin_sum",
        note: "Defined as the sum of that day's pin impressions; Pinterest has no separate dedup'd account-reach figure.",
      },
    ],
  },
  {
    metric: "Impressions",
    column: "Impressions",
    grain: "Account · per day",
    aggregation: "window_sum",
    summary: "Total times content was shown. Summed per real-measurement day over the window.",
    origins: [
      {
        platform: "instagram",
        apiField: null,
        source: "null",
        note: "Instagram retired account-level impressions in 2024 (now 'views', which v22.0 exposes only as a period total). No honest per-day impressions exists; we do not invent one.",
      },
      {
        platform: "facebook",
        apiField: "page_total_media_view_unique (v22.0, page token)",
        source: "daily_real",
        note: "Real per-day account impressions.",
      },
      {
        platform: "pinterest",
        apiField: "sum of per-pin IMPRESSION (v5 pin analytics)",
        source: "pin_sum",
        note: "Same pin-sum definition as Pinterest reach.",
      },
    ],
  },
  {
    metric: "Views (30d)",
    column: "Views",
    grain: "Account · rolling 30-day total",
    aggregation: "period_snapshot",
    summary:
      "Instagram's replacement for the retired account impressions metric. Meta exposes it only as a rolling 30-day account total (never a per-day series), so it is written to the newest row and shown as a 30-day figure — never summed across the date window.",
    origins: [
      {
        platform: "instagram",
        apiField: "views (metric_type=total_value, 30-day), Graph API v22.0",
        source: "period_aggregate",
        note: "Replaces the retired IG account-level impressions. v22.0 exposes Views only as a rolling 30-day total, written to the newest row and tagged period_aggregate; taken as a latest value, never summed across days.",
      },
      {
        platform: "facebook",
        apiField: null,
        source: "null",
        note: "Not applicable — Facebook still reports account impressions directly (see Impressions). Views is an Instagram-only replacement metric.",
      },
      {
        platform: "pinterest",
        apiField: null,
        source: "null",
        note: "Not applicable — Pinterest reports impressions directly (pin-sum).",
      },
    ],
  },
  {
    metric: "Followers",
    column: "Followers",
    grain: "Account · snapshot",
    aggregation: "latest_snapshot",
    summary: "Follower count. A point-in-time snapshot — the latest value in the window, never summed.",
    origins: [
      {
        platform: "instagram",
        apiField: "followers_count (v22.0)",
        source: "real-or-absent",
        note: "Account follower total.",
      },
      {
        platform: "facebook",
        apiField: "page_follows / fan count (v22.0)",
        source: "real-or-absent",
        note: "Page follower total (a near-flat figure is the metric's nature, not a freeze).",
      },
      {
        platform: "pinterest",
        apiField: "follower_count (v5 user_account)",
        source: "real-or-absent",
        note: "Account follower total.",
      },
    ],
  },
  {
    metric: "Engagement Rate",
    column: "Engagement Rate",
    grain: "Account · per day",
    aggregation: "window_sum",
    summary: "Engagement relative to reach/impressions. Derived per day; replaces the retired overloaded 'ER Type' field.",
    origins: [
      {
        platform: "instagram",
        apiField: "derived from per-post engagement ÷ reach",
        source: "real-or-absent",
        note: "Posts-derived daily rate where posts exist that day; otherwise absent.",
      },
      {
        platform: "facebook",
        apiField: "page_post_engagements ÷ impressions (v22.0)",
        source: "real-or-absent",
        note: "A real 0 (no engagement that day) is distinct from absent.",
      },
      {
        platform: "pinterest",
        apiField: "(SAVE + PIN_CLICK) ÷ impressions (v5)",
        source: "real-or-absent",
        note: "Derived from the account analytics window where available.",
      },
    ],
  },
  {
    metric: "Instagram 30-day figures",
    column: "Profile Views / Accounts Engaged / Interactions / Profile Links Taps (30d)",
    grain: "Account · rolling 30-day total",
    aggregation: "period_snapshot",
    summary: "Profile Views, Accounts Engaged, Interactions and Link Taps that Instagram reports only as a rolling 30-day total. Shown in their own labelled tiles; NEVER summed across days and unaffected by the date filter.",
    origins: [
      {
        platform: "instagram",
        apiField: "metric_type=total_value (profile_views, accounts_engaged, total_interactions, profile_links_taps), v22.0",
        source: "period_aggregate",
        note: "v22.0 exposes no honest per-day form; written to the newest row only, tagged period_aggregate.",
      },
    ],
  },
];

// ---------------------------------------------------------------------------
// Live data-status: read the real Account Daily Facts and report what's there.
// ---------------------------------------------------------------------------

interface PlatformStatus {
  platform: string;
  rows: number;
  earliest: string;
  latest: string;
  pending: number;
  settled: number;
  reachSources: string[];
  imprSources: string[];
}

function summarizeAccountFacts(records: AirtableRecord[]): PlatformStatus[] {
  const byPlatform = new Map<string, AirtableRecord[]>();
  for (const r of records) {
    const p = str(r.fields["Platform"]).toLowerCase();
    if (!p) continue;
    if (!byPlatform.has(p)) byPlatform.set(p, []);
    byPlatform.get(p)!.push(r);
  }
  const out: PlatformStatus[] = [];
  for (const [platform, rows] of byPlatform) {
    const dates = rows
      .map((r) => str(r.fields["Date"]))
      .filter(Boolean)
      .sort();
    const statuses = rows.map((r) => str(r.fields["data_status"]));
    const reachSources = Array.from(
      new Set(rows.map((r) => str(r.fields["Reach Source"])).filter(Boolean)),
    ).sort();
    const imprSources = Array.from(
      new Set(
        rows.map((r) => str(r.fields["Impressions Source"])).filter(Boolean),
      ),
    ).sort();
    out.push({
      platform,
      rows: rows.length,
      earliest: dates[0] ?? "—",
      latest: dates[dates.length - 1] ?? "—",
      pending: statuses.filter((s) => s === "pending").length,
      settled: statuses.filter((s) => s === "settled").length,
      reachSources,
      imprSources,
    });
  }
  return out.sort((a, b) => a.platform.localeCompare(b.platform));
}

// ---------------------------------------------------------------------------
// Presentation
// ---------------------------------------------------------------------------

function Section({
  title,
  subtitle,
  children,
}: {
  title: string;
  subtitle?: string;
  children: React.ReactNode;
}) {
  return (
    <section
      className="rounded-xl p-5 sm:p-6"
      style={{ background: "var(--bg-card)", border: "1px solid var(--border)" }}
    >
      <h2 className="text-base font-semibold mb-1">{title}</h2>
      {subtitle && (
        <p className="text-[13px] mb-3" style={{ color: "var(--text-secondary)" }}>
          {subtitle}
        </p>
      )}
      <div
        className="space-y-3 text-sm leading-relaxed"
        style={{ color: "var(--text-secondary)" }}
      >
        {children}
      </div>
    </section>
  );
}

function PlatformChip({ platform }: { platform: string }) {
  const cfg = getPlatformConfig(platform);
  return (
    <span
      className="text-[11px] px-1.5 py-0.5 rounded font-semibold"
      style={{ background: cfg.colorBg, color: cfg.color }}
    >
      {cfg.label}
    </span>
  );
}

function SourceTag({ tag }: { tag: string }) {
  const isAbsent = tag === "null";
  return (
    <code
      className="text-[11px] px-1.5 py-0.5 rounded font-mono"
      style={{
        background: isAbsent ? "var(--bg-secondary)" : "var(--brand-bg, var(--bg-secondary))",
        color: isAbsent ? "var(--text-secondary)" : "var(--text-primary)",
        border: "1px solid var(--border)",
      }}
    >
      {tag}
    </code>
  );
}

function LiveStatusPanel() {
  const [status, setStatus] = useState<PlatformStatus[] | null>(null);
  const [error, setError] = useState(false);

  useEffect(() => {
    let cancelled = false;
    fetch("/api/airtable")
      .then((r) => (r.ok ? r.json() : Promise.reject()))
      .then((data) => {
        if (cancelled) return;
        const facts: AirtableRecord[] = data.accountDailyFacts ?? [];
        setStatus(summarizeAccountFacts(facts));
      })
      .catch(() => !cancelled && setError(true));
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <Section
      title="Live data status"
      subtitle="Read directly from the Account Daily Facts table right now — not a description, the actual contents."
    >
      {error && (
        <p style={{ color: "var(--text-secondary)" }}>
          Could not load live status. The model below still applies.
        </p>
      )}
      {!error && !status && (
        <p style={{ color: "var(--text-secondary)" }}>Loading live status…</p>
      )}
      {status && status.length === 0 && (
        <p style={{ color: "var(--text-secondary)" }}>
          No account daily facts present yet.
        </p>
      )}
      {status && status.length > 0 && (
        <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
          {status.map((s) => (
            <div
              key={s.platform}
              className="rounded-lg p-3"
              style={{
                background: "var(--bg-secondary)",
                border: "1px solid var(--border)",
              }}
            >
              <div className="flex items-center justify-between mb-2">
                <PlatformChip platform={s.platform} />
                <span className="text-[11px]" style={{ color: "var(--text-secondary)" }}>
                  {s.rows} days
                </span>
              </div>
              <dl className="text-[12px] space-y-1">
                <div className="flex justify-between gap-2">
                  <dt style={{ color: "var(--text-secondary)" }}>Range</dt>
                  <dd style={{ color: "var(--text-primary)" }}>
                    {s.earliest} → {s.latest}
                  </dd>
                </div>
                <div className="flex justify-between gap-2">
                  <dt style={{ color: "var(--text-secondary)" }}>Settle</dt>
                  <dd style={{ color: "var(--text-primary)" }}>
                    {s.settled} settled · {s.pending} pending
                  </dd>
                </div>
                <div className="flex justify-between gap-2 flex-wrap">
                  <dt style={{ color: "var(--text-secondary)" }}>Reach src</dt>
                  <dd className="flex gap-1 flex-wrap justify-end">
                    {s.reachSources.length ? (
                      s.reachSources.map((t) => <SourceTag key={t} tag={t} />)
                    ) : (
                      <SourceTag tag="null" />
                    )}
                  </dd>
                </div>
                <div className="flex justify-between gap-2 flex-wrap">
                  <dt style={{ color: "var(--text-secondary)" }}>Impr src</dt>
                  <dd className="flex gap-1 flex-wrap justify-end">
                    {s.imprSources.length ? (
                      s.imprSources.map((t) => <SourceTag key={t} tag={t} />)
                    ) : (
                      <SourceTag tag="null" />
                    )}
                  </dd>
                </div>
              </dl>
            </div>
          ))}
        </div>
      )}
    </Section>
  );
}

function MetricCard({ m }: { m: MetricLineage }) {
  return (
    <div
      className="rounded-lg p-4"
      style={{ background: "var(--bg-secondary)", border: "1px solid var(--border)" }}
    >
      <div className="flex items-baseline justify-between gap-3 flex-wrap mb-1">
        <span className="font-semibold text-[15px]" style={{ color: "var(--text-primary)" }}>
          {m.metric}
        </span>
        <span className="text-[11px]" style={{ color: "var(--text-secondary)" }}>
          {m.grain}
        </span>
      </div>
      <p className="text-[13px] mb-2">{m.summary}</p>
      <div className="flex items-center gap-2 flex-wrap mb-3 text-[12px]">
        <span style={{ color: "var(--text-secondary)" }}>Aggregation:</span>
        <span style={{ color: "var(--text-primary)" }}>{AGG_LABEL[m.aggregation]}</span>
        <span style={{ color: "var(--text-secondary)" }}>· Column:</span>
        <code className="font-mono text-[11px]">{m.column}</code>
      </div>
      <div className="space-y-1.5">
        {m.origins.map((o) => (
          <div
            key={o.platform}
            className="rounded-md p-2.5"
            style={{ background: "var(--bg-card)", border: "1px solid var(--border)" }}
          >
            <div className="flex items-center gap-2 flex-wrap mb-1">
              <PlatformChip platform={o.platform} />
              <SourceTag tag={o.source} />
              {o.apiField ? (
                <code className="text-[11px] font-mono" style={{ color: "var(--text-secondary)" }}>
                  {o.apiField}
                </code>
              ) : (
                <span className="text-[11px]" style={{ color: "var(--text-secondary)" }}>
                  not reported
                </span>
              )}
            </div>
            <p className="text-[12.5px]">{o.note}</p>
          </div>
        ))}
      </div>
    </div>
  );
}

export default function MethodologyContent() {
  const metrics = useMemo(() => METRIC_LINEAGE, []);

  return (
    <div className="space-y-5 max-w-4xl">
      <Section title="How to read this page">
        <p>
          Every account-level number on this dashboard comes from one
          authoritative source per metric, stored at the grain the platform
          actually measures. Where a platform&apos;s API does not report a
          metric, the value is left blank rather than shown as zero or filled
          with a stand-in — <strong>a blank is information</strong>: the platform
          does not measure that, we did not fail to track it.
        </p>
        <p style={{ color: "var(--text-secondary)" }}>
          The status panel below is read live from the data. The metric cards
          and the pipeline describe the model that produces it. ELT can read the
          summaries; analytics engineers can read the API field, grain, and
          provenance tag on each card.
        </p>
      </Section>

      <LiveStatusPanel />

      <Section
        title="Metric lineage"
        subtitle="Origin, grain, provenance and aggregation for each account metric, per platform."
      >
        <div className="space-y-3">
          {metrics.map((m) => (
            <MetricCard key={m.metric} m={m} />
          ))}
        </div>
      </Section>

      <Section
        title="Provenance vocabulary"
        subtitle="Every value carries a Source tag in its own column — never overloaded onto a semantic field."
      >
        <div className="space-y-2">
          {SOURCE_VOCAB.map((v) => (
            <div key={v.tag} className="flex gap-3 items-start">
              <div className="pt-0.5 shrink-0">
                <SourceTag tag={v.tag} />
              </div>
              <p className="text-[13px]">{v.meaning}</p>
            </div>
          ))}
        </div>
      </Section>

      <Section
        title="The pipeline"
        subtitle="From platform API to the number on screen."
      >
        <ol className="space-y-2 text-[13px] list-none">
          <li>
            <strong style={{ color: "var(--text-primary)" }}>1 · Collect.</strong>{" "}
            Nightly n8n refreshers call each platform&apos;s API (Meta Graph
            v22.0; Pinterest v5) and write one append-only row per platform per
            day into <code className="font-mono text-[11px]">Account Daily Facts</code>{" "}
            (<code className="font-mono text-[11px]">{ACCOUNT_DAILY_FACTS_TABLE}</code>),
            and one row per pin per day into{" "}
            <code className="font-mono text-[11px]">Post Daily Facts</code>{" "}
            (<code className="font-mono text-[11px]">{POST_DAILY_FACTS_TABLE}</code>).
            Every volatile value is written with its own Source tag.
          </li>
          <li>
            <strong style={{ color: "var(--text-primary)" }}>2 · Settle.</strong>{" "}
            Each run re-fetches the trailing window, so days that arrived{" "}
            <em>pending</em> self-correct to their{" "}
            <em>settled</em> value over ~1-2 days. Settled values are stable.
          </li>
          <li>
            <strong style={{ color: "var(--text-primary)" }}>3 · Aggregate.</strong>{" "}
            The dashboard sums the per-day cells over your selected window — only
            from rows whose Source marks a real measurement for that metric, so
            one metric&apos;s absence never sums as a false zero. Period figures
            (the Instagram 30-day tiles) are read from the newest snapshot row
            and never summed.
          </li>
          <li>
            <strong style={{ color: "var(--text-primary)" }}>4 · Guard.</strong>{" "}
            A daily health check asserts the provenance invariants (Instagram
            impressions stay blank, reach stays a real measurement, Pinterest
            stays a pin-sum, period figures stay on the newest row) so a pipeline
            regression surfaces rather than silently corrupting a number.
          </li>
        </ol>
      </Section>

      <Section title="Why a blank is never a zero">
        <p>
          A zero would assert &quot;this platform reached zero people&quot; —
          false when the platform simply does not publish that metric. We never
          sum per-post numbers into an account total to fill a gap, because
          adding up posts counts the same person once per post they saw and
          overstates true reach. There are two deliberate, clearly-tagged
          exceptions where a platform publishes no dedup&apos;d account reach.
          Pinterest: account reach and impressions are defined as the
          pin-impression sum, tagged <SourceTag tag="pin_sum" />. Facebook (from
          2026-06-20): account reach is proxied by page_total_media_view_unique
          (the same metric behind FB impressions), tagged{" "}
          <SourceTag tag="daily_proxy" />. Both are tagged distinctly so the
          definition is never confused with a directly-measured figure.
        </p>
      </Section>
    </div>
  );
}
