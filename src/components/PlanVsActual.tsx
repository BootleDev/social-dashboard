"use client";

import { useMemo, useState } from "react";
import ChartCard from "./ChartCard";
import PostDrilldownPanel from "./PostDrilldownPanel";
import StatsPanel from "./StatsPanel";
import InfoTooltip from "./InfoTooltip";
import { getPlatformConfig, platformSortOrder } from "@/lib/platforms";
import { describe } from "@/lib/stats";
import {
  num,
  str,
  formatLocalDate,
  recordReach,
  formatNumber,
  type AirtableRecord,
} from "@/lib/utils";
import {
  parseContentPlan,
  comparePlanToActual,
  buildCalendar,
  filterPlanPlatforms,
  type PlanComparison,
  type CalendarWeek,
  type CalendarPost,
} from "@/lib/contentPlan";
import rawPlan from "@/config/contentPlan.json";

interface PlanVsActualProps {
  posts: AirtableRecord[];
  /** Selected range. Nulls (All Time) fall back to the posts' own span. */
  range: { start: string | null; end: string | null };
  timezone: string;
  /**
   * The dashboard's global platform filter (lowercase keys; empty = all).
   * The plan is scoped to the same platforms as the posts, otherwise every
   * filtered-out platform's slots would read as false misses.
   */
  selectedPlatforms?: Set<string>;
}

type View = "calendar" | "summary";

/**
 * Plan vs. actual — measures shipped content against the rolling target plan in
 * src/config/contentPlan.json. Two views:
 *   - Calendar: day-by-day grid grouped into weeks, most-recent-first. Planned
 *     slots show hit/miss; real posts are clickable for per-post detail.
 *   - Summary: aggregate hit rate, weekly adherence, pillar mix, worst slots.
 *
 * The matching + calendar engines (lib/contentPlan.ts) are pure + unit-tested;
 * this component only renders their output and offers drilldowns.
 */
export default function PlanVsActual({
  posts,
  range,
  timezone,
  selectedPlatforms,
}: PlanVsActualProps) {
  const [view, setView] = useState<View>("calendar");
  const [drill, setDrill] = useState<{
    posts: AirtableRecord[];
    label: string;
  } | null>(null);

  // Parse once. A malformed config should surface loudly rather than render
  // wrong numbers, so we catch and show the error instead of crashing the tab.
  const parsed = useMemo(() => {
    try {
      return { plan: parseContentPlan(rawPlan), error: "" };
    } catch (e) {
      return { plan: null, error: e instanceof Error ? e.message : String(e) };
    }
  }, []);

  // Scope the plan to the same platforms as the (already filtered) posts, so
  // a single-channel view scores only that channel's slots.
  const plan = useMemo(() => {
    if (!parsed.plan) return null;
    return filterPlanPlatforms(parsed.plan, selectedPlatforms ?? new Set());
  }, [parsed.plan, selectedPlatforms]);

  // Resolve concrete bounds. When the date filter is "All Time" (null), derive
  // the span from the posts themselves so the plan expands over real data.
  const bounds = useMemo(() => {
    if (range.start && range.end) return { start: range.start, end: range.end };
    const dates = posts
      .map((p) => formatLocalDate(str(p.fields["Published At"]), timezone))
      .filter(Boolean)
      .sort();
    return {
      start: range.start ?? dates[0] ?? "",
      end: range.end ?? dates[dates.length - 1] ?? "",
    };
  }, [range.start, range.end, posts, timezone]);

  const result: PlanComparison | null = useMemo(() => {
    if (!plan || !bounds.start || !bounds.end) return null;
    return comparePlanToActual(plan, posts, bounds, timezone);
  }, [plan, posts, bounds, timezone]);

  // The calendar extends forward past the data so the upcoming plan is visible:
  // its end is pushed to the Sunday after next (covering the rest of this week
  // plus all of next week). Stats above stay scoped to the real filter bounds —
  // only the calendar grid looks ahead, where future weeks show ghost slots.
  const calendarBounds = useMemo(() => {
    if (!bounds.start || !bounds.end) return bounds;
    return { start: bounds.start, end: maxDate(bounds.end, endOfNextWeek()) };
  }, [bounds]);

  const calendar: CalendarWeek[] = useMemo(() => {
    if (!plan || !calendarBounds.start || !calendarBounds.end) return [];
    // Pass today so unshipped future slots render as "upcoming" (to-do) rather
    // than "miss" (failure), and drop out of forward weeks' adherence counts.
    return buildCalendar(plan, posts, calendarBounds, timezone, todayYmd());
  }, [plan, posts, calendarBounds, timezone]);

  if (parsed.error) {
    return (
      <Notice tone="danger">
        Content plan config is invalid: {parsed.error}. Fix
        <code className="mx-1">src/config/contentPlan.json</code>.
      </Notice>
    );
  }

  if (!result || result.totals.planned === 0) {
    return (
      <Notice tone="muted">
        No planned slots fall in this window. Widen the date range, or check that
        the plan in <code className="mx-1">src/config/contentPlan.json</code> is
        effective for this period.
      </Notice>
    );
  }

  const { totals } = result;

  return (
    <div className="space-y-4">
      {/* High-level stats over every post in view */}
      <PostStats posts={posts} totals={totals} onDrill={(p, l) => setDrill({ posts: p, label: l })} />

      {/* View toggle */}
      <div className="flex gap-1 w-fit rounded-lg p-1" style={{ background: "var(--bg-secondary)" }}>
        {(["calendar", "summary"] as View[]).map((v) => (
          <button
            key={v}
            onClick={() => setView(v)}
            className="px-3 py-1.5 rounded text-xs font-medium capitalize cursor-pointer transition-all"
            style={{
              background: view === v ? "var(--brand)" : "transparent",
              color: view === v ? "#fff" : "var(--text-secondary)",
            }}
          >
            {v}
          </button>
        ))}
      </div>

      {view === "calendar" ? (
        <CalendarView
          weeks={calendar}
          timezone={timezone}
          onPostClick={(p) =>
            setDrill({ posts: [p], label: postTitle(p) })
          }
        />
      ) : (
        <SummaryView result={result} onDrill={(p, l) => setDrill({ posts: p, label: l })} selectedPlatforms={selectedPlatforms} />
      )}

      {drill && (
        <PostDrilldownPanel
          posts={drill.posts}
          bucketLabel={drill.label}
          timezone={timezone}
          onClose={() => setDrill(null)}
        />
      )}
    </div>
  );
}

// ── High-level post stats ────────────────────────────────────────────────────

function PostStats({
  posts,
  totals,
  onDrill,
}: {
  posts: AirtableRecord[];
  totals: PlanComparison["totals"];
  onDrill: (p: AirtableRecord[], label: string) => void;
}) {
  const erStats = useMemo(() => {
    const ers = posts
      .map((p) => num(p.fields["Engagement Rate"]) * 100)
      .filter((v) => v > 0);
    return ers.length >= 3 ? describe(ers) : undefined;
  }, [posts]);

  const totalEngagement = useMemo(
    () => posts.reduce((s, p) => s + num(p.fields["Engagement"]), 0),
    [posts],
  );

  // Per-platform breakdowns. ER and reach mean different things per platform
  // (Pinterest has no reach; IG ER is by-reach), so an aggregate blends apples
  // and oranges — break them out, ordered by the platform's sort order.
  const byPlatform = useMemo(() => groupByPlatform(posts), [posts]);

  const erBreakdown = useMemo(
    () =>
      byPlatform
        .map(({ platform, posts: ps }) => {
          const ers = ps.map((p) => num(p.fields["Engagement Rate"]) * 100).filter((v) => v > 0);
          const mean = ers.length ? ers.reduce((a, b) => a + b, 0) / ers.length : 0;
          return { platform, value: ers.length ? `${mean.toFixed(2)}%` : "—" };
        })
        .filter((b) => b.value !== "—"),
    [byPlatform],
  );

  const reachBreakdown = useMemo(
    () =>
      byPlatform
        .map(({ platform, posts: ps }) => ({
          platform,
          value: formatNumber(ps.reduce((s, p) => s + recordReach(p), 0)),
        }))
        .filter((b) => b.value !== "0"),
    [byPlatform],
  );

  const totalReach = useMemo(
    () => posts.reduce((s, p) => s + recordReach(p), 0),
    [posts],
  );

  return (
    <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
      <Stat
        label="Hit rate"
        value={pct(totals.hitRate)}
        accent
        tooltip="Share of planned, countable slots that were filled in this window. Stories are reminders and aren't counted. A slot is filled when a matching post (platform + post type, pillar optional) shipped that ISO week."
      />
      <Stat
        label="Hit / Planned"
        value={`${totals.hit} / ${totals.planned}`}
        tooltip="Slots filled vs. total planned countable slots in the window. Pinterest is planned daily; Instagram per the weekly cadence; Facebook mirrors the cross-posted reels."
      />
      <Stat
        label="Missed"
        value={String(totals.missed)}
        sub={totals.offPillar > 0 ? `${totals.offPillar} off-pillar` : undefined}
        tooltip="Planned slots with no matching post that week. 'Off-pillar' counts hits whose pillar differs from the plan — still a hit (pillar is a soft signal), but it shifts the actual mix."
      />
      <Stat
        label="Posts shipped"
        value={String(posts.length)}
        sub={totals.unplanned > 0 ? `${totals.unplanned} unplanned` : undefined}
        onClick={posts.length > 0 ? () => onDrill(posts, "All posts in window") : undefined}
        tooltip="Total posts that actually published in this window across all platforms. 'Unplanned' shipped but matched no planned slot (off-plan). Click to inspect them all."
      />
      <Stat
        label="Total engagement"
        value={formatNumber(totalEngagement)}
        tooltip="Sum of likes, comments, saves, and shares across every post in the window."
      />
      <Stat
        label="Avg ER · by platform"
        value={erStats ? `${erStats.mean.toFixed(2)}%` : "—"}
        breakdown={erBreakdown}
        tooltip="Average engagement rate, broken out per platform because the denominator differs (Instagram ER is by reach; Pinterest is by impressions). The top figure is the blended average; the rows are the honest per-platform values. Hover the icon next to the value for the full distribution."
        headerAction={
          erStats ? (
            <StatsPanel stats={erStats} format={(v) => `${v.toFixed(2)}%`} context="Engagement Rate across posts in window" />
          ) : undefined
        }
      />
      <Stat
        label="Reach · by platform"
        value={formatNumber(totalReach)}
        breakdown={reachBreakdown}
        tooltip="Total reach (unique accounts reached), broken out per platform. Pinterest reports impressions rather than reach, so its 'reach' here is impressions — kept separate so the platforms don't blend."
      />
    </div>
  );
}

/** Group posts by platform in the dashboard's canonical platform sort order. */
function groupByPlatform(
  posts: AirtableRecord[],
): Array<{ platform: string; posts: AirtableRecord[] }> {
  const map = new Map<string, AirtableRecord[]>();
  for (const p of posts) {
    const platform = str(p.fields["Platform"]).toLowerCase().trim();
    if (!platform) continue;
    const arr = map.get(platform);
    if (arr) arr.push(p);
    else map.set(platform, [p]);
  }
  return [...map.entries()]
    .map(([platform, ps]) => ({ platform, posts: ps }))
    .sort((a, b) => platformSortOrder(a.platform) - platformSortOrder(b.platform));
}

// ── Calendar view ────────────────────────────────────────────────────────────

function CalendarView({
  weeks,
  timezone,
  onPostClick,
}: {
  weeks: CalendarWeek[];
  timezone: string;
  onPostClick: (p: AirtableRecord) => void;
}) {
  if (weeks.length === 0) {
    return <Notice tone="muted">No days in this window.</Notice>;
  }
  return (
    <div className="space-y-4">
      <Legend />
      {weeks.map((w) => (
        <WeekGrid key={w.weekKey} week={w} onPostClick={onPostClick} />
      ))}
    </div>
  );
}

/**
 * One week as a Mon-Sun grid. Each day shows the posts that ACTUALLY published
 * that day (solid, clickable), ghost outlines for slots planned-but-not-shipped
 * (anchored to their day), and muted reminders for informational slots (e.g.
 * Stories). Weeks that start in the future render as "upcoming" — the plan is
 * shown, but the hit rate isn't framed as failure.
 */
function WeekGrid({
  week,
  onPostClick,
}: {
  week: CalendarWeek;
  onPostClick: (p: AirtableRecord) => void;
}) {
  // Engine returns days most-recent-first; the grid wants calendar order.
  const days = [...week.days].sort((a, b) => a.date.localeCompare(b.date));
  const upcoming = week.start > todayYmd();

  return (
    <div
      className="rounded-xl overflow-hidden"
      style={{
        background: "var(--bg-card)",
        border: "1px solid var(--border)",
        ...(upcoming ? { borderStyle: "dashed" } : {}),
      }}
    >
      {/* Week header */}
      <div
        className="flex items-center justify-between gap-2 px-4 py-2.5"
        style={{ borderBottom: "1px solid var(--border)" }}
      >
        <h3 className="text-sm font-semibold flex items-center gap-2" style={{ color: "var(--text-primary)" }}>
          {shortDate(week.start)} – {shortDate(week.end)}
          {upcoming && (
            <span
              className="text-[10px] font-medium px-1.5 py-0.5 rounded uppercase tracking-wide"
              style={{ background: "var(--bg-secondary)", color: "var(--text-secondary)" }}
            >
              Upcoming
            </span>
          )}
        </h3>
        {upcoming ? (
          <span className="text-[11px] tabular-nums shrink-0 flex items-center gap-1" style={{ color: "var(--text-secondary)" }}>
            {week.planned} planned
            <InfoTooltip text="Slots planned for this upcoming week. Nothing has shipped yet, so there's no hit rate." label="About upcoming weeks" />
          </span>
        ) : (
          <div className="flex items-center gap-2">
            <div className="w-20 h-1.5 rounded-full overflow-hidden" style={{ background: "var(--bg-secondary)" }}>
              <div className="h-full rounded-full" style={{ width: `${Math.round(week.hitRate * 100)}%`, background: barColor(week.hitRate) }} />
            </div>
            <span
              className="text-[11px] font-medium tabular-nums shrink-0 px-1.5 py-0.5 rounded"
              style={{ color: barColor(week.hitRate), background: "var(--bg-secondary)" }}
            >
              {week.hit}/{week.planned}
            </span>
            <InfoTooltip text="Planned, countable slots filled this week (Stories are reminders and aren't counted). A slot is filled when a matching post shipped that ISO week." label="About weekly hit rate" />
          </div>
        )}
      </div>

      {/* 7-column day grid */}
      <div className="grid grid-cols-1 sm:grid-cols-7">
        {days.map((d, i) => (
          <DayCell
            key={d.date}
            day={d}
            onPostClick={onPostClick}
            lastCol={(i + 1) % 7 === 0}
          />
        ))}
      </div>
    </div>
  );
}

function DayCell({
  day,
  onPostClick,
  lastCol,
}: {
  day: CalendarWeek["days"][number];
  onPostClick: (p: AirtableRecord) => void;
  lastCol: boolean;
}) {
  // Separate the slot kinds. Hits aren't drawn here (the post itself renders in
  // `posts`). Upcoming = future to-do, miss = past failure, reminder = Story.
  const upcoming = day.plannedSlots.filter((s) => s.status === "upcoming" && !s.informational);
  const misses = day.plannedSlots.filter((s) => s.status === "miss" && !s.informational);
  const reminders = day.plannedSlots.filter((s) => s.informational);
  const isWeekend = day.dayLabel === "Sat" || day.dayLabel === "Sun";
  const isToday = day.date === todayYmd();
  const empty =
    day.posts.length === 0 &&
    upcoming.length === 0 &&
    misses.length === 0 &&
    reminders.length === 0;

  return (
    <div
      className="p-2 flex flex-col gap-1 min-h-[6rem]"
      style={{
        borderRight: lastCol ? "none" : "1px solid var(--border)",
        borderTop: "1px solid var(--border)",
        background: isToday
          ? "var(--brand-soft, var(--bg-secondary))"
          : isWeekend
            ? "var(--bg-secondary)"
            : "transparent",
      }}
    >
      {/* Day header */}
      <div className="flex items-baseline justify-between mb-0.5">
        <span
          className="text-[11px] font-semibold"
          style={{ color: isToday ? "var(--brand)" : "var(--text-secondary)" }}
        >
          {day.dayLabel}
        </span>
        <span className="text-[10px] tabular-nums" style={{ color: "var(--text-secondary)", opacity: 0.7 }}>
          {dayNum(day.date)}
        </span>
      </div>

      {/* Posts that shipped — solid, clickable */}
      {day.posts.map((cp) => (
        <PostChip key={cp.record.id} cp={cp} onClick={() => onPostClick(cp.record)} />
      ))}

      {/* Upcoming to-dos — solid empty-checkbox chips, anchored to target day */}
      {upcoming.map((s, i) => (
        <UpcomingChip key={`up-${i}`} slot={s} />
      ))}

      {/* Past planned-but-not-shipped — muted dashed "missed" chips */}
      {misses.map((s, i) => (
        <MissChip key={`miss-${i}`} slot={s} />
      ))}

      {/* Informational reminders (Stories) — muted, not scored */}
      {reminders.map((s, i) => (
        <ReminderChip key={`rem-${i}`} slot={s} />
      ))}

      {empty && (
        <span className="text-[10px] mt-auto" style={{ color: "var(--text-secondary)", opacity: 0.35 }}>
          —
        </span>
      )}
    </div>
  );
}

function PostChip({ cp, onClick }: { cp: CalendarPost; onClick: () => void }) {
  const cfg = getPlatformConfig(cp.platform);
  return (
    <button
      onClick={onClick}
      className="w-full text-[10px] px-1.5 py-1 rounded flex items-center gap-1 leading-none cursor-pointer transition-all hover:brightness-110 text-left"
      title={`${cfg.label} ${cp.postType}${cp.pillar ? ` · ${cp.pillar}` : ""} — ${cp.planned ? "fills a planned slot" : "unplanned (off-plan)"}. Click for detail.`}
      style={{
        background: cfg.colorFill,
        color: "var(--text-primary)",
        borderLeft: `2px solid ${cfg.color}`,
      }}
    >
      <span className="truncate flex-1">{cp.postType}</span>
      {/* Checked box = shipped/done. Planned hits use the platform accent; an
          off-plan post is still "done" but muted with a + to flag it wasn't on
          the plan. */}
      <span style={{ color: cp.planned ? cfg.color : "var(--text-secondary)", opacity: cp.planned ? 1 : 0.6 }}>
        {cp.planned ? "☑" : "☑+"}
      </span>
    </button>
  );
}

/**
 * Upcoming to-do: a planned slot whose day is today or ahead, not yet shipped.
 * Solid platform-colored border + empty checkbox = "to do, not done". No
 * strikethrough, no red — this is the plan, not a failure.
 */
function UpcomingChip({ slot }: { slot: CalendarWeek["days"][number]["plannedSlots"][number] }) {
  const cfg = getPlatformConfig(slot.platform);
  const label = slot.postType ?? "pin";
  return (
    <div
      className="w-full text-[10px] px-1.5 py-1 rounded flex items-center gap-1 leading-none"
      title={`To do: ${cfg.label} ${label}${slot.pillar ? ` · ${slot.pillar}` : ""} — planned, not shipped yet`}
      style={{
        border: `1px solid ${cfg.color}`,
        borderLeft: `2px solid ${cfg.color}`,
        color: "var(--text-primary)",
      }}
    >
      <span className="truncate flex-1">{label}</span>
      <span style={{ color: cfg.color }}>☐</span>
    </div>
  );
}

/**
 * Past miss: a countable planned slot whose day has passed with nothing shipped.
 * Muted dashed card + red × = a genuine adherence failure (no strikethrough,
 * which read as "done/cancelled" rather than "missed").
 */
function MissChip({ slot }: { slot: CalendarWeek["days"][number]["plannedSlots"][number] }) {
  const cfg = getPlatformConfig(slot.platform);
  const label = slot.postType ?? "pin";
  return (
    <div
      className="w-full text-[10px] px-1.5 py-1 rounded flex items-center gap-1 leading-none"
      title={`Missed: ${cfg.label} ${label}${slot.pillar ? ` · ${slot.pillar}` : ""} — planned but not shipped`}
      style={{ border: "1px dashed var(--border)", color: "var(--text-secondary)", opacity: 0.75 }}
    >
      <span className="truncate flex-1">{label}</span>
      <span style={{ color: "var(--danger, #E5484D)" }}>×</span>
    </div>
  );
}

/** Muted reminder for an informational slot (e.g. Stories) — not scored. */
function ReminderChip({ slot }: { slot: CalendarWeek["days"][number]["plannedSlots"][number] }) {
  const cfg = getPlatformConfig(slot.platform);
  const label = slot.postType ?? "post";
  return (
    <div
      className="w-full text-[10px] px-1.5 py-1 rounded flex items-center gap-1 leading-none"
      title={`Reminder: ${cfg.label} ${label} — planned daily, but not tracked (Stories aren't captured in the data, so they don't count toward the hit rate).`}
      style={{ background: "var(--bg-secondary)", color: "var(--text-secondary)", opacity: 0.65 }}
    >
      <span className="truncate flex-1">{label}</span>
      <span style={{ opacity: 0.7 }}>♢</span>
    </div>
  );
}

/** Explains the chip vocabulary + platform colors used in the calendar grid. */
function Legend() {
  const ig = getPlatformConfig("instagram");
  const pin = getPlatformConfig("pinterest");
  const platforms = ["instagram", "facebook", "pinterest"];

  return (
    <div
      className="rounded-xl p-3 text-[11px]"
      style={{ background: "var(--bg-card)", border: "1px solid var(--border)", color: "var(--text-secondary)" }}
    >
      <div className="flex flex-col sm:flex-row sm:items-start gap-x-8 gap-y-3">
        {/* Chip meanings */}
        <div className="flex-1">
          <div className="font-medium mb-1.5" style={{ color: "var(--text-primary)" }}>
            What the chips mean
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-1.5">
            <LegendItem
              chip={
                <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded" style={{ background: ig.colorFill, borderLeft: `2px solid ${ig.color}` }}>
                  reel <span style={{ color: ig.color }}>☑</span>
                </span>
              }
              desc="Shipped — fills a planned slot"
            />
            <LegendItem
              chip={
                <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded" style={{ background: pin.colorFill, borderLeft: `2px solid ${pin.color}` }}>
                  static <span style={{ color: "var(--text-secondary)", opacity: 0.6 }}>☑+</span>
                </span>
              }
              desc="Shipped — off-plan (unplanned)"
            />
            <LegendItem
              chip={
                <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded" style={{ border: `1px solid ${ig.color}`, borderLeft: `2px solid ${ig.color}`, color: "var(--text-primary)" }}>
                  carousel <span style={{ color: ig.color }}>☐</span>
                </span>
              }
              desc="Upcoming — planned, still to do"
            />
            <LegendItem
              chip={
                <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded" style={{ border: "1px dashed var(--border)", opacity: 0.75 }}>
                  carousel <span style={{ color: "var(--danger, #E5484D)" }}>×</span>
                </span>
              }
              desc="Missed — past, not shipped"
            />
            <LegendItem
              chip={
                <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded" style={{ background: "var(--bg-secondary)", opacity: 0.65 }}>
                  story <span style={{ opacity: 0.7 }}>♢</span>
                </span>
              }
              desc="Reminder (e.g. Stories) — not counted"
            />
          </div>
          <div className="mt-2 text-[10px]" style={{ opacity: 0.8 }}>
            Shipped posts sit on the day they published; click one for detail. Upcoming and missed chips sit on their planned day. An empty box ☐ is still to do; a × is a past miss.
          </div>
        </div>

        {/* Platform colors */}
        <div className="shrink-0">
          <div className="font-medium mb-1.5" style={{ color: "var(--text-primary)" }}>
            Platforms
          </div>
          <div className="flex flex-col gap-1">
            {platforms.map((p) => (
              <span key={p} className="flex items-center gap-1.5">
                <span className="inline-block w-2 h-2 rounded-full" style={{ background: getPlatformConfig(p).color }} />
                {getPlatformConfig(p).label}
                {p === "facebook" && <span style={{ opacity: 0.6 }}>(reel cross-post)</span>}
              </span>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

function LegendItem({ chip, desc }: { chip: React.ReactNode; desc: string }) {
  return (
    <span className="flex items-center gap-2">
      <span className="shrink-0">{chip}</span>
      <span>{desc}</span>
    </span>
  );
}


// ── Summary view (aggregate) ─────────────────────────────────────────────────

function SummaryView({
  result,
  onDrill,
  selectedPlatforms,
}: {
  result: PlanComparison;
  onDrill: (p: AirtableRecord[], label: string) => void;
  selectedPlatforms?: Set<string>;
}) {
  const { perWeek, perSlot, pillarMix, matched, totals, perPlatform } = result;
  return (
    <div className="space-y-4">
      <ChartCard
        title="By channel"
        tooltip="Plan adherence split per platform: hit rate over the window, planned/hit/missed slot counts, posts shipped outside the plan, and the week-by-week trend. Informational slots (Stories) are excluded, as everywhere."
      >
        <div className="space-y-3">
          {perPlatform.map((p) => {
            const config = getPlatformConfig(p.platform);
            return (
              <div key={p.platform} className="text-xs">
                <div className="flex items-center justify-between mb-1">
                  <span className="flex items-center gap-1.5 font-medium" style={{ color: "var(--text-primary)" }}>
                    <span className="inline-block w-2 h-2 rounded-full shrink-0" style={{ background: config.color }} />
                    {config.label}
                  </span>
                  <span className="tabular-nums" style={{ color: "var(--text-secondary)" }}>
                    {p.planned > 0 ? (
                      <>
                        <span style={{ color: barColor(p.hitRate) }}>{pct(p.hitRate)}</span>
                        {" · "}{p.hit}/{p.planned} slots
                      </>
                    ) : (
                      "no planned slots"
                    )}
                    {p.unplanned > 0 && <> · {p.unplanned} unplanned</>}
                  </span>
                </div>
                <div className="flex items-center gap-3">
                  <div className="flex-1 h-4 rounded overflow-hidden" style={{ background: "var(--bg-secondary)" }}>
                    {p.planned > 0 && (
                      <div className="h-full" style={{ width: `${Math.round(p.hitRate * 100)}%`, background: config.color }} />
                    )}
                  </div>
                  {/* perWeek is a plan-adherence series, so it only covers
                      weeks the platform had a scored slot in. Platforms that
                      only shipped unplanned posts have no series and show no
                      sparkbars (length <= 1) — adherence is undefined with
                      nothing planned, so a trend there would be misleading. */}
                  {p.perWeek.length > 1 && (
                    <div className="flex items-end gap-0.5 h-4 shrink-0" title="Weekly hit rate, oldest → newest">
                      {p.perWeek.map((w) => (
                        <div
                          key={w.weekKey}
                          className="w-1.5 rounded-sm"
                          style={{
                            // 15% floor keeps a 0%-week bar visible; perWeek
                            // entries always have planned >= 1 (built from
                            // scored slots), so hitRate is never NaN here.
                            height: `${Math.max(15, Math.round(w.hitRate * 100))}%`,
                            background: barColor(w.hitRate),
                            opacity: w.planned > 0 ? 1 : 0.3,
                          }}
                          title={`${w.weekKey}: ${w.hit}/${w.planned} (${pct(w.hitRate)})`}
                        />
                      ))}
                    </div>
                  )}
                </div>
              </div>
            );
          })}
          {perPlatform.length === 0 && (
            <p style={{ color: "var(--text-secondary)" }}>
              {selectedPlatforms && selectedPlatforms.size > 0
                ? "No planned slots or posts for the selected platform(s) in this window."
                : "No planned slots or posts in this window."}
            </p>
          )}
        </div>
      </ChartCard>

      <ChartCard
        title="Weekly adherence"
        tooltip="Share of planned slots filled each ISO week. A slot is filled when a post of the same platform + post type ships that week (any day). Pillar is not required for a hit."
      >
        <div className="space-y-2">
          {[...perWeek].reverse().map((w) => (
            <div key={w.weekKey} className="flex items-center gap-3 text-xs">
              <span className="w-20 shrink-0 tabular-nums" style={{ color: "var(--text-secondary)" }}>
                {w.weekKey}
              </span>
              <div className="flex-1 h-4 rounded overflow-hidden" style={{ background: "var(--bg-secondary)" }}>
                <div className="h-full" style={{ width: `${Math.round(w.hitRate * 100)}%`, background: barColor(w.hitRate) }} />
              </div>
              <span className="w-16 shrink-0 text-right tabular-nums">
                {w.hit}/{w.planned}
              </span>
            </div>
          ))}
        </div>
      </ChartCard>

      <ChartCard
        title="Pillar mix — planned vs actual"
        tooltip="Target pillar share (from monthlyPillarMix in the plan) against the actual share of pillar-tagged posts shipped in this window. Untagged posts are excluded from the actual share."
      >
        <div className="space-y-3">
          {pillarMix.map((p) => (
            <div key={p.pillar} className="text-xs">
              <div className="flex justify-between mb-1">
                <span style={{ color: "var(--text-primary)" }}>{p.pillar}</span>
                <span style={{ color: "var(--text-secondary)" }}>
                  plan {pct(p.planned)} · actual {pct(p.actual)}
                </span>
              </div>
              <div className="relative h-3 rounded" style={{ background: "var(--bg-secondary)" }}>
                <div className="absolute inset-y-0 left-0 rounded" style={{ width: `${Math.round(p.actual * 100)}%`, background: "var(--brand)" }} />
                {p.planned > 0 && (
                  <div
                    className="absolute inset-y-0"
                    style={{ left: `calc(${Math.min(100, p.planned * 100)}% - 1px)`, width: "2px", background: "var(--text-primary)" }}
                    title={`Target ${pct(p.planned)}`}
                  />
                )}
              </div>
            </div>
          ))}
          <p className="text-[11px]" style={{ color: "var(--text-secondary)" }}>
            Bar = actual share shipped. Vertical marker = planned target.
          </p>
        </div>
      </ChartCard>

      <ChartCard title="Misses by slot" tooltip="Which recurring slots get skipped most over the window. Sorted by miss rate, then by how often the slot is planned.">
        <div className="space-y-1.5">
          {perSlot.map((s) => (
            <div key={s.label} className="flex items-center justify-between text-xs py-1" style={{ borderBottom: "1px solid var(--border)" }}>
              <span style={{ color: "var(--text-primary)" }}>{s.label}</span>
              <span className="tabular-nums" style={{ color: missColor(s.missRate) }}>
                {s.planned - s.hit}/{s.planned} missed ({pct(s.missRate)})
              </span>
            </div>
          ))}
        </div>
      </ChartCard>

      {totals.offPillar > 0 && (
        <Notice tone="muted">
          {totals.offPillar} planned slot{totals.offPillar === 1 ? "" : "s"} were filled by a post whose
          pillar differs from the plan. Counts as a hit (pillar is a soft signal) but shifts the actual mix.{" "}
          <button
            className="underline cursor-pointer"
            onClick={() =>
              onDrill(
                matched.filter((m) => m.offPillar && m.post).map((m) => m.post as AirtableRecord),
                "Off-pillar hits",
              )
            }
          >
            View posts
          </button>
        </Notice>
      )}
    </div>
  );
}

// ── presentational helpers ───────────────────────────────────────────────────

function pct(n: number): string {
  return `${Math.round(n * 100)}%`;
}
function barColor(rate: number): string {
  if (rate >= 0.8) return "var(--success, #46A758)";
  if (rate >= 0.5) return "var(--brand)";
  return "var(--danger, #E5484D)";
}
function missColor(rate: number): string {
  return rate >= 0.5 ? "var(--danger, #E5484D)" : "var(--text-secondary)";
}
function shortDate(ymd: string): string {
  // "2026-05-29" -> "May 29"
  const [y, m, d] = ymd.split("-").map((p) => parseInt(p, 10));
  if (!y || !m || !d) return ymd;
  const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  return `${months[m - 1]} ${d}`;
}
function dayNum(ymd: string): string {
  // "2026-05-29" -> "29"
  const d = parseInt(ymd.split("-")[2] ?? "", 10);
  return Number.isFinite(d) ? String(d) : "";
}
function maxDate(a: string, b: string): string {
  return a >= b ? a : b;
}
/** Today as YYYY-MM-DD (UTC). Client-side; used to flag upcoming weeks. */
function todayYmd(): string {
  return new Date().toISOString().slice(0, 10);
}
/**
 * The Sunday at the end of NEXT week (YYYY-MM-DD), so the calendar can show the
 * remainder of this week plus all of next week as upcoming plan. Client-side
 * only (uses the real clock), which is why it lives here, not in the lib.
 */
function endOfNextWeek(): string {
  const now = new Date();
  const dow = (now.getUTCDay() + 6) % 7; // Mon=0..Sun=6
  // This week's Sunday is (6 - dow) days ahead; add 7 for next week's Sunday.
  const target = new Date(now);
  target.setUTCDate(now.getUTCDate() + (6 - dow) + 7);
  return target.toISOString().slice(0, 10);
}
function postTitle(p: AirtableRecord): string {
  const platform = getPlatformConfig(str(p.fields["Platform"])).label;
  const type = str(p.fields["Post Type"]) || "post";
  const date = str(p.fields["Published At"]).slice(0, 10);
  return `${platform} ${type} · ${date}`;
}

interface StatProps {
  label: string;
  value: string;
  sub?: string;
  accent?: boolean;
  onClick?: () => void;
  headerAction?: React.ReactNode;
  /** Explanatory tooltip for the metric. */
  tooltip?: string;
  /** Per-platform breakdown rows shown beneath the value. */
  breakdown?: Array<{ platform: string; value: string }>;
}

function Stat({ label, value, sub, accent, onClick, headerAction, tooltip, breakdown }: StatProps) {
  return (
    <div
      className={`rounded-xl p-3 ${onClick ? "cursor-pointer" : ""}`}
      style={{ background: "var(--bg-card)", border: "1px solid var(--border)" }}
      onClick={onClick}
    >
      <div className="flex items-center justify-between gap-1">
        <div className="text-[11px] flex items-center gap-1" style={{ color: "var(--text-secondary)" }}>
          {label}
          {tooltip && <InfoTooltip text={tooltip} label={`About ${label}`} />}
        </div>
        {headerAction}
      </div>
      <div className="text-xl font-semibold tabular-nums mt-0.5" style={{ color: accent ? "var(--brand)" : "var(--text-primary)" }}>
        {value}
      </div>
      {sub && (
        <div className="text-[11px] mt-0.5" style={{ color: "var(--text-secondary)" }}>
          {sub}
        </div>
      )}
      {breakdown && breakdown.length > 0 && (
        <div className="mt-1.5 flex flex-col gap-0.5">
          {breakdown.map((b) => (
            <div key={b.platform} className="flex items-center justify-between text-[10px] tabular-nums" style={{ color: "var(--text-secondary)" }}>
              <span className="flex items-center gap-1">
                <span className="inline-block w-1.5 h-1.5 rounded-full" style={{ background: getPlatformConfig(b.platform).color }} />
                {getPlatformConfig(b.platform).label}
              </span>
              <span>{b.value}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function Notice({ children, tone }: { children: React.ReactNode; tone: "danger" | "muted" }) {
  return (
    <div
      className="rounded-xl p-4 text-sm"
      style={{
        background: tone === "danger" ? "var(--danger-soft, var(--bg-card))" : "var(--bg-card)",
        border: `1px solid ${tone === "danger" ? "var(--danger, #E5484D)" : "var(--border)"}`,
        color: tone === "danger" ? "var(--danger, #E5484D)" : "var(--text-secondary)",
      }}
    >
      {children}
    </div>
  );
}
