"use client";

import { getPlatformConfig } from "@/lib/platforms";

/**
 * In-app explanation of how the dashboard's account-level numbers are sourced
 * (WEBDEV-146). This is the reader-facing copy of the per-grain source model
 * documented in src/lib/airtable.ts. Keep the two in sync — if the data model
 * changes, update both. Per-metric KPI tooltips point here.
 *
 * Content only (no page chrome) so it can live at /dashboard/methodology and be
 * embedded elsewhere if needed.
 */

function Section({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <section
      className="rounded-xl p-5 sm:p-6"
      style={{
        background: "var(--bg-card)",
        border: "1px solid var(--border)",
      }}
    >
      <h2 className="text-base font-semibold mb-3">{title}</h2>
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

/** A "reports / doesn't report" line for one metric, per platform. */
function MetricLine({
  metric,
  reports,
  absent,
  note,
}: {
  metric: string;
  reports: string[];
  absent?: { platform: string; why: string }[];
  note?: string;
}) {
  return (
    <div
      className="rounded-lg p-3"
      style={{ background: "var(--bg-secondary)", border: "1px solid var(--border)" }}
    >
      <div className="flex items-center gap-2 flex-wrap mb-1.5">
        <span className="font-medium" style={{ color: "var(--text-primary)" }}>
          {metric}
        </span>
        {reports.map((p) => (
          <PlatformChip key={p} platform={p} />
        ))}
      </div>
      {absent?.map((a) => (
        <p key={a.platform} className="text-[13px]">
          <span style={{ color: "var(--text-primary)" }}>
            {getPlatformConfig(a.platform).label}
          </span>
          : no pill — {a.why}
        </p>
      ))}
      {note && <p className="text-[13px] mt-1">{note}</p>}
    </div>
  );
}

export default function MethodologyContent() {
  return (
    <div className="space-y-5 max-w-3xl">
      <Section title="How these numbers are made">
        <p>
          Every account-level number on this dashboard comes from one
          authoritative source per type of metric, and each platform is shown
          only the metrics it genuinely reports. Where a platform&apos;s API
          does not report a metric, the number is left out rather than shown as
          zero or filled with a stand-in. A blank is information: it means the
          platform does not measure that, not that we failed to track it.
        </p>
      </Section>

      <Section title="Account metrics, per platform">
        <p>
          Account-level reach, impressions, followers and engagement come from
          our daily-facts record — one row per platform per day, each value
          stored with the day it was measured. The window totals you see are
          sums over those daily rows for your selected date range.
        </p>
        <div className="space-y-2 pt-1">
          <MetricLine
            metric="Reach"
            reports={["instagram"]}
            absent={[
              {
                platform: "facebook",
                why:
                  "Facebook's Graph API (v22.0) reports no account-level reach. There is no value to show on any day — not a tracking gap.",
              },
            ]}
            note="Pinterest account reach joins once its daily-facts pipeline lands (it is defined as the sum of that day's pin impressions, since Pinterest has no separate account-reach figure)."
          />
          <MetricLine
            metric="Impressions"
            reports={["facebook"]}
            absent={[
              {
                platform: "instagram",
                why:
                  "Instagram retired account-level impressions in 2024 and now reports 'views' instead. We do not invent an impressions number for it.",
              },
            ]}
            note="Pinterest impressions join with its daily-facts pipeline."
          />
          <MetricLine
            metric="Followers & Engagement Rate"
            reports={["instagram", "facebook"]}
            note="Reported by both platforms at the account level; Pinterest joins with its pipeline."
          />
        </div>
      </Section>

      <Section title="Why some cells are blank, not zero">
        <p>
          A zero would say &quot;this platform reached zero people&quot; — which
          is false when the platform simply does not publish that metric. We
          treat a metric at its true grain: an account-level figure is shown
          only when the platform measures it at the account level. We never sum
          per-post numbers into an account total to fill a gap, because adding
          up posts counts the same person once per post they saw and overstates
          true reach.
        </p>
      </Section>

      <Section title="Pinterest is a deliberate exception">
        <p>
          Pinterest does not publish a deduplicated account-reach figure the way
          Instagram does. For Pinterest only, account reach and impressions are
          defined as the sum of that day&apos;s pin impressions. This is
          intentional and is Pinterest&apos;s real distribution figure — not the
          old bug where a rolling window made numbers appear to shrink over time.
          It is tagged distinctly in the data so it is never confused with a
          directly-measured account number.
        </p>
      </Section>

      <Section title="The Instagram 30-day figures">
        <p>
          Profile Views, Accounts Engaged, Interactions and Link Taps shown
          under &quot;Instagram · last 30 days&quot; are rolling 30-day totals
          that Instagram reports directly. They are <strong>not</strong> a sum
          of the days in your selected range, so they do not change when you
          change the date filter, and they are never added across days. They sit
          in their own labelled row to keep that distinction clear.
        </p>
      </Section>

      <Section title="Late-settling data">
        <p>
          Some days arrive as <em>pending</em> and settle over the following
          day or two as the platforms finalize their counts. Once a day is
          settled its value stops changing; if a settled value later moves, that
          is recorded as a visible restatement rather than silently overwritten.
        </p>
      </Section>
    </div>
  );
}
