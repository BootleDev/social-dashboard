/**
 * Content plan vs. actual — matching engine.
 *
 * The plan (src/config/contentPlan.json) declares a recurring weekly set of
 * target output slots. This module expands that pattern across a date range and
 * matches each target slot to a real post, so the dashboard can show how many
 * planned posts were hit, how many were missed, and how the planned creative
 * mix compares to what actually shipped.
 *
 * Matching rules (agreed 2026-05-29):
 *   - Window: same ISO week. A slot is satisfied by a matching post published
 *     any day that week (day-of-week is a soft target for now; cadence will
 *     tighten to day-level later).
 *   - Keys: Platform + Post Type are REQUIRED for a hit. Pillar is a SOFT
 *     signal — when a slot names a pillar and the matched post's pillar differs,
 *     it still counts as a hit but is flagged `offPillar`. Pillar balance is
 *     reported separately via the planned-vs-actual mix.
 *   - Consumption: each post satisfies at most one slot (greedy). Extra posts
 *     beyond the planned slots that week surface as `unplanned`.
 *
 * All functions here are pure and deterministic: same plan + same posts in ->
 * same result out. No Airtable calls, no clock reads (the range is passed in).
 */

import { num, str, formatLocalDate, type AirtableRecord } from "./utils";

/** Day-of-week labels as produced by dayOfWeekLocal / used in the plan config. */
export const DAY_LABELS = [
  "Sun",
  "Mon",
  "Tue",
  "Wed",
  "Thu",
  "Fri",
  "Sat",
] as const;
export type DayLabel = (typeof DAY_LABELS)[number];

export interface PlanSlot {
  /** Soft target day-of-week (Mon..Sun). Not enforced under ISO-week matching. */
  day: DayLabel;
  /** Airtable Platform enum string, e.g. "instagram". */
  platform: string;
  /**
   * Airtable Post Type enum string, e.g. "reel". Optional: omit it to make the
   * slot match ANY post type on that platform (a wildcard). Used for Pinterest,
   * where "ship a pin that day" doesn't care whether the media is static or
   * video — a pin is a pin.
   */
  postType?: string;
  /** Optional Airtable Content Pillar enum string. Soft signal when present. */
  pillar?: string;
  /**
   * When true, the slot is shown on the calendar as a reminder but is EXCLUDED
   * from hit/planned/hit-rate and all adherence stats. Used for slots we plan
   * but can't verify against the data (e.g. Instagram Stories, which aren't
   * captured by the scraper). Counting them would produce permanent false
   * misses and make the hit rate meaningless.
   */
  informational?: boolean;
}

export interface PlanOverride extends PlanSlot {
  /** Specific date (YYYY-MM-DD) this override applies to, instead of recurring. */
  date: string;
}

export interface ContentPlan {
  /** Plan is inert before this date (YYYY-MM-DD). */
  effectiveFrom: string;
  weekly: PlanSlot[];
  /** Pillar -> target share (fractions summing to ~1). Optional. */
  monthlyPillarMix?: Record<string, number>;
  overrides: PlanOverride[];
}

const VALID_DAYS = new Set<string>(DAY_LABELS);

/**
 * Validate + normalize a raw parsed JSON object into a ContentPlan. Throws on
 * structural problems so a malformed config fails loudly rather than silently
 * producing wrong adherence numbers. Mirrors the defensive-at-the-boundary
 * style used elsewhere in this codebase (no Zod dependency).
 */
export function parseContentPlan(raw: unknown): ContentPlan {
  if (!raw || typeof raw !== "object") {
    throw new Error("contentPlan: config must be an object");
  }
  const obj = raw as Record<string, unknown>;

  const effectiveFrom = str(obj.effectiveFrom);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(effectiveFrom)) {
    throw new Error(
      `contentPlan: effectiveFrom must be YYYY-MM-DD, got "${effectiveFrom}"`,
    );
  }

  const weeklyRaw = Array.isArray(obj.weekly) ? obj.weekly : [];
  const weekly = weeklyRaw.map((s, i) => parseSlot(s, `weekly[${i}]`));

  const overridesRaw = Array.isArray(obj.overrides) ? obj.overrides : [];
  const overrides = overridesRaw.map((o, i) => parseOverride(o, `overrides[${i}]`));

  let monthlyPillarMix: Record<string, number> | undefined;
  if (obj.monthlyPillarMix && typeof obj.monthlyPillarMix === "object") {
    monthlyPillarMix = {};
    for (const [k, v] of Object.entries(
      obj.monthlyPillarMix as Record<string, unknown>,
    )) {
      const n = num(v);
      if (n > 0) monthlyPillarMix[k] = n;
    }
  }

  return { effectiveFrom, weekly, monthlyPillarMix, overrides };
}

function parseSlot(raw: unknown, where: string): PlanSlot {
  if (!raw || typeof raw !== "object") {
    throw new Error(`contentPlan: ${where} must be an object`);
  }
  const o = raw as Record<string, unknown>;
  const day = str(o.day);
  if (!VALID_DAYS.has(day)) {
    throw new Error(
      `contentPlan: ${where}.day must be one of ${DAY_LABELS.join("/")}, got "${day}"`,
    );
  }
  const platform = str(o.platform).toLowerCase().trim();
  // postType is OPTIONAL: omit (or leave empty) for a wildcard slot that matches
  // any post type on the platform.
  const postType = o.postType != null ? str(o.postType).toLowerCase().trim() : "";
  if (!platform) throw new Error(`contentPlan: ${where}.platform is required`);
  const pillar = o.pillar != null ? str(o.pillar).trim() : undefined;
  const informational = o.informational === true;
  return {
    day: day as DayLabel,
    platform,
    postType: postType || undefined,
    pillar: pillar || undefined,
    informational: informational || undefined,
  };
}

function parseOverride(raw: unknown, where: string): PlanOverride {
  const slot = parseSlot(raw, where);
  const o = raw as Record<string, unknown>;
  const date = str(o.date);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    throw new Error(`contentPlan: ${where}.date must be YYYY-MM-DD, got "${date}"`);
  }
  return { ...slot, date };
}

/**
 * ISO-8601 week key "GGGG-Www" (e.g. "2026-W22") for a YYYY-MM-DD date.
 * ISO weeks start Monday; week 1 is the week containing the first Thursday.
 * Computed in UTC from the date string so it's timezone-stable once the caller
 * has already resolved the post's local calendar date.
 */
export function isoWeekKey(ymd: string): string {
  const [y, m, d] = ymd.split("-").map((p) => parseInt(p, 10));
  if (!y || !m || !d) return "";
  // Shift to the Thursday of this week, then derive year + week number.
  const date = new Date(Date.UTC(y, m - 1, d));
  const dayNum = (date.getUTCDay() + 6) % 7; // Mon=0..Sun=6
  date.setUTCDate(date.getUTCDate() - dayNum + 3); // move to Thursday
  const isoYear = date.getUTCFullYear();
  const firstThursday = new Date(Date.UTC(isoYear, 0, 4));
  const firstDayNum = (firstThursday.getUTCDay() + 6) % 7;
  firstThursday.setUTCDate(firstThursday.getUTCDate() - firstDayNum + 3);
  const week =
    1 +
    Math.round(
      (date.getTime() - firstThursday.getTime()) / (7 * 24 * 3600 * 1000),
    );
  return `${isoYear}-W${String(week).padStart(2, "0")}`;
}

/**
 * Resolve the calendar date (YYYY-MM-DD) of a given weekday within an ISO week.
 * `weekKey` is "GGGG-Www"; `day` is Mon..Sun. ISO weeks start Monday, so the
 * Monday of the week is derived from the week number and the requested weekday
 * is an offset from there. Returns "" on a malformed weekKey.
 */
export function dateForWeekday(weekKey: string, day: DayLabel): string {
  const m = /^(\d{4})-W(\d{2})$/.exec(weekKey);
  if (!m) return "";
  const isoYear = parseInt(m[1], 10);
  const week = parseInt(m[2], 10);
  // Monday of ISO week 1 = the Monday on or before Jan 4.
  const jan4 = new Date(Date.UTC(isoYear, 0, 4));
  const jan4Dow = (jan4.getUTCDay() + 6) % 7; // Mon=0..Sun=6
  const week1Monday = new Date(jan4);
  week1Monday.setUTCDate(jan4.getUTCDate() - jan4Dow);
  // Offset to the requested week, then to the requested weekday.
  const mondayOffsetForDay = (DAY_LABELS.indexOf(day) + 6) % 7; // Mon=0..Sun=6
  const target = new Date(week1Monday);
  target.setUTCDate(
    week1Monday.getUTCDate() + (week - 1) * 7 + mondayOffsetForDay,
  );
  return target.toISOString().slice(0, 10);
}

/** All ISO-week keys touched by [start, end] inclusive (both YYYY-MM-DD). */
export function weekKeysInRange(start: string, end: string): string[] {
  if (!start || !end || start > end) return [];
  const keys: string[] = [];
  const seen = new Set<string>();
  const [sy, sm, sd] = start.split("-").map((p) => parseInt(p, 10));
  const [ey, em, ed] = end.split("-").map((p) => parseInt(p, 10));
  const cursor = new Date(Date.UTC(sy, sm - 1, sd));
  const endDate = new Date(Date.UTC(ey, em - 1, ed));
  while (cursor.getTime() <= endDate.getTime()) {
    const ymd = cursor.toISOString().slice(0, 10);
    const key = isoWeekKey(ymd);
    if (key && !seen.has(key)) {
      seen.add(key);
      keys.push(key);
    }
    cursor.setUTCDate(cursor.getUTCDate() + 7); // step a week at a time
  }
  // Guard the trailing edge: stepping by 7 can skip the final partial week.
  const lastKey = isoWeekKey(end);
  if (lastKey && !seen.has(lastKey)) keys.push(lastKey);
  return keys;
}

/** An expanded target: one plan slot instantiated for a specific ISO week. */
export interface TargetSlot extends PlanSlot {
  weekKey: string;
  /** True when this came from a date-specific override rather than `weekly`. */
  fromOverride: boolean;
}

/**
 * Expand the recurring weekly plan (plus overrides) across the date range into
 * concrete per-week target slots. Weeks before effectiveFrom are skipped.
 */
export function expandTargets(
  plan: ContentPlan,
  range: { start: string; end: string },
): TargetSlot[] {
  const effectiveWeek = isoWeekKey(plan.effectiveFrom);
  const weekKeys = weekKeysInRange(range.start, range.end).filter(
    (k) => k >= effectiveWeek,
  );

  const targets: TargetSlot[] = [];
  for (const weekKey of weekKeys) {
    for (const slot of plan.weekly) {
      targets.push({ ...slot, weekKey, fromOverride: false });
    }
  }
  for (const ov of plan.overrides) {
    if (ov.date < range.start || ov.date > range.end) continue;
    if (ov.date < plan.effectiveFrom) continue;
    targets.push({ ...ov, weekKey: isoWeekKey(ov.date), fromOverride: true });
  }
  return targets;
}

export interface MatchedTarget {
  target: TargetSlot;
  /** The post that satisfied this slot, or null if missed. */
  post: AirtableRecord | null;
  status: "hit" | "miss";
  /** Hit but the post's pillar differs from the slot's named pillar. */
  offPillar: boolean;
}

export interface PlanComparison {
  matched: MatchedTarget[];
  /** Posts in range that matched no target slot. */
  unplanned: AirtableRecord[];
  totals: {
    planned: number;
    hit: number;
    missed: number;
    offPillar: number;
    unplanned: number;
    /** hit / planned, 0..1; 0 when nothing planned. */
    hitRate: number;
  };
  /** Per ISO-week adherence, oldest-first. */
  perWeek: Array<{ weekKey: string; planned: number; hit: number; hitRate: number }>;
  /** Slots that get missed most, keyed by platform+postType(+pillar). */
  perSlot: Array<{
    label: string;
    platform: string;
    postType?: string;
    pillar?: string;
    planned: number;
    hit: number;
    missRate: number;
  }>;
  /** Planned vs actual pillar share over the range (actual = matched + unplanned posts). */
  pillarMix: Array<{ pillar: string; planned: number; actual: number }>;
}

function postPlatform(p: AirtableRecord): string {
  return str(p.fields["Platform"]).toLowerCase().trim();
}
function postType(p: AirtableRecord): string {
  return str(p.fields["Post Type"]).toLowerCase().trim();
}
function postPillar(p: AirtableRecord): string {
  return str(p.fields["Content Pillar"]).trim();
}
function slotLabel(s: PlanSlot): string {
  // Wildcard slots (no postType) read as e.g. "pinterest (any)".
  const base = `${s.platform} ${s.postType ?? "(any)"}`;
  return s.pillar ? `${base} · ${s.pillar}` : base;
}

/**
 * Match expanded targets against posts. Pure: pass the already date+platform
 * filtered posts and the same range used to expand targets.
 */
export function comparePlanToActual(
  plan: ContentPlan,
  posts: AirtableRecord[],
  range: { start: string; end: string },
  timezone = "",
): PlanComparison {
  const targets = expandTargets(plan, range);

  // Index posts by ISO week (using their local published date).
  const postsByWeek = new Map<string, AirtableRecord[]>();
  for (const p of posts) {
    const iso = str(p.fields["Published At"]);
    if (!iso) continue;
    const ymd = formatLocalDate(iso, timezone) || iso.slice(0, 10);
    const key = isoWeekKey(ymd);
    if (!key) continue;
    const arr = postsByWeek.get(key);
    if (arr) arr.push(p);
    else postsByWeek.set(key, [p]);
  }

  const consumed = new Set<AirtableRecord>();
  const matched: MatchedTarget[] = [];

  for (const target of targets) {
    // Informational slots (e.g. Stories) are reminders only: they never consume
    // a post and never resolve to hit/miss for scoring. Record as a miss-shaped
    // entry so the calendar can render them, but they're filtered from all
    // counts below via `m.target.informational`.
    if (target.informational) {
      matched.push({ target, post: null, status: "miss", offPillar: false });
      continue;
    }
    const candidates = postsByWeek.get(target.weekKey) ?? [];
    const hit = candidates.find(
      (p) =>
        !consumed.has(p) &&
        postPlatform(p) === target.platform &&
        // postType undefined on the slot = wildcard: any type on this platform.
        (!target.postType || postType(p) === target.postType),
    );
    if (hit) {
      consumed.add(hit);
      const offPillar =
        !!target.pillar &&
        postPillar(hit) !== "" &&
        postPillar(hit) !== target.pillar;
      matched.push({ target, post: hit, status: "hit", offPillar });
    } else {
      matched.push({ target, post: null, status: "miss", offPillar: false });
    }
  }

  const unplanned = posts.filter((p) => !consumed.has(p));

  // Scored = everything except informational slots. All adherence numbers use
  // this set so informational reminders never distort the hit rate.
  const scored = matched.filter((m) => !m.target.informational);
  const hit = scored.filter((m) => m.status === "hit").length;
  const missed = scored.length - hit;
  const offPillar = scored.filter((m) => m.offPillar).length;
  const totals = {
    planned: scored.length,
    hit,
    missed,
    offPillar,
    unplanned: unplanned.length,
    hitRate: scored.length > 0 ? hit / scored.length : 0,
  };

  // Per-week adherence (scored slots only).
  const weekAgg = new Map<string, { planned: number; hit: number }>();
  for (const m of scored) {
    const a = weekAgg.get(m.target.weekKey) ?? { planned: 0, hit: 0 };
    a.planned += 1;
    if (m.status === "hit") a.hit += 1;
    weekAgg.set(m.target.weekKey, a);
  }
  const perWeek = [...weekAgg.entries()]
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([weekKey, a]) => ({
      weekKey,
      planned: a.planned,
      hit: a.hit,
      hitRate: a.planned > 0 ? a.hit / a.planned : 0,
    }));

  // Per-slot miss rate (grouped by the slot's identity, across all weeks).
  const slotAgg = new Map<
    string,
    { platform: string; postType?: string; pillar?: string; planned: number; hit: number }
  >();
  for (const m of scored) {
    const label = slotLabel(m.target);
    const a =
      slotAgg.get(label) ??
      {
        platform: m.target.platform,
        postType: m.target.postType,
        pillar: m.target.pillar,
        planned: 0,
        hit: 0,
      };
    a.planned += 1;
    if (m.status === "hit") a.hit += 1;
    slotAgg.set(label, a);
  }
  const perSlot = [...slotAgg.entries()]
    .map(([label, a]) => ({
      label,
      platform: a.platform,
      postType: a.postType,
      pillar: a.pillar,
      planned: a.planned,
      hit: a.hit,
      missRate: a.planned > 0 ? (a.planned - a.hit) / a.planned : 0,
    }))
    .sort((x, y) => y.missRate - x.missRate || y.planned - x.planned);

  // Planned vs actual pillar mix. Actual share = posts of pillar / total posts
  // with a pillar tagged (matched + unplanned both count as real output).
  const pillarMix = buildPillarMix(plan, posts);

  return { matched, unplanned, totals, perWeek, perSlot, pillarMix };
}

function buildPillarMix(
  plan: ContentPlan,
  posts: AirtableRecord[],
): Array<{ pillar: string; planned: number; actual: number }> {
  const actualCounts = new Map<string, number>();
  let totalTagged = 0;
  for (const p of posts) {
    const pillar = postPillar(p);
    if (!pillar) continue;
    actualCounts.set(pillar, (actualCounts.get(pillar) ?? 0) + 1);
    totalTagged += 1;
  }
  const pillars = new Set<string>([
    ...Object.keys(plan.monthlyPillarMix ?? {}),
    ...actualCounts.keys(),
  ]);
  return [...pillars]
    .map((pillar) => ({
      pillar,
      planned: plan.monthlyPillarMix?.[pillar] ?? 0,
      actual: totalTagged > 0 ? (actualCounts.get(pillar) ?? 0) / totalTagged : 0,
    }))
    .sort((a, b) => b.planned - a.planned || b.actual - a.actual);
}

// ── Calendar view ────────────────────────────────────────────────────────────

/**
 * A planned slot anchored to its target calendar day, with its state.
 *
 * - `hit`: a matching post shipped that ISO week.
 * - `miss`: the slot's target day is in the past and nothing shipped — a real
 *   adherence failure.
 * - `upcoming`: the slot's target day is today or in the future and nothing has
 *   shipped yet — a to-do, NOT a failure. Excluded from adherence scoring.
 *
 * `upcoming` only appears when `buildCalendar` is given a `today`; without it,
 * every unshipped slot is a `miss` (backward-compatible, clock-free behavior).
 */
export interface CalendarPlannedSlot {
  platform: string;
  postType?: string;
  pillar?: string;
  status: "hit" | "miss" | "upcoming";
  offPillar: boolean;
  /** Reminder-only slot (e.g. Stories) — excluded from week hit/planned counts. */
  informational: boolean;
  /** The satisfying post, if hit. May have published on a different day. */
  post: AirtableRecord | null;
}

/** A real post anchored to the day it published. */
export interface CalendarPost {
  record: AirtableRecord;
  platform: string;
  postType: string;
  pillar: string;
  /** True when this post satisfied a planned slot (vs. extra/unplanned). */
  planned: boolean;
}

export interface CalendarDay {
  date: string; // YYYY-MM-DD
  dayLabel: DayLabel;
  /** Planned slots whose target weekday is this day. */
  plannedSlots: CalendarPlannedSlot[];
  /** Posts that actually published this day (planned hits + unplanned). */
  posts: CalendarPost[];
}

export interface CalendarWeek {
  weekKey: string;
  /** Monday..Sunday range as YYYY-MM-DD, for the header. */
  start: string;
  end: string;
  planned: number;
  hit: number;
  hitRate: number;
  /** Days, most-recent-first. */
  days: CalendarDay[];
}

const DOW_FROM_DAYLABEL: Record<DayLabel, number> = {
  Sun: 0,
  Mon: 1,
  Tue: 2,
  Wed: 3,
  Thu: 4,
  Fri: 5,
  Sat: 6,
};

function dayLabelFromDate(ymd: string): DayLabel {
  const [y, m, d] = ymd.split("-").map((p) => parseInt(p, 10));
  const dow = new Date(Date.UTC(y, m - 1, d)).getUTCDay();
  return DAY_LABELS[dow];
}

/**
 * Build a day-by-day calendar grouped into weeks, most-recent-first.
 *
 * Honest two-layer representation per day:
 *   - `plannedSlots`: targets whose intended weekday is this day, showing
 *     hit/miss. A slot can be "hit" by a post that published a different day
 *     (ISO-week matching), so the satisfying post is attached but lives in its
 *     own day's `posts` list.
 *   - `posts`: posts that actually published this day, tagged planned/unplanned.
 *
 * Pass the same plan/posts/range/timezone used for comparePlanToActual.
 *
 * `today` (YYYY-MM-DD) splits unshipped slots into past `miss` vs future
 * `upcoming`: a slot whose target day is > today and has no post becomes
 * `upcoming` (a to-do) instead of `miss` (a failure), and is dropped from the
 * week's adherence counts. Pass "" (the default) to keep the engine clock-free
 * and treat every unshipped slot as a `miss`.
 */
export function buildCalendar(
  plan: ContentPlan,
  posts: AirtableRecord[],
  range: { start: string; end: string },
  timezone = "",
  today = "",
): CalendarWeek[] {
  const comparison = comparePlanToActual(plan, posts, range, timezone);

  // date -> day bucket. We seed days from both planned slots and real posts so
  // empty-but-planned days (pure misses) still appear.
  const dayMap = new Map<string, CalendarDay>();
  const ensureDay = (date: string): CalendarDay | null => {
    if (!date || date < range.start || date > range.end) return null;
    let day = dayMap.get(date);
    if (!day) {
      day = {
        date,
        dayLabel: dayLabelFromDate(date),
        plannedSlots: [],
        posts: [],
      };
      dayMap.set(date, day);
    }
    return day;
  };

  // Layer 1: planned slots on their target weekday.
  for (const m of comparison.matched) {
    const date = dateForWeekday(m.target.weekKey, m.target.day);
    const day = ensureDay(date);
    if (!day) continue;
    // A miss whose target day hasn't arrived yet is not a failure — it's an
    // upcoming to-do. Reclassify only when we know "today" and only for real
    // (non-informational) misses; hits and reminders are unaffected.
    // `date >= today`: a slot due TODAY that hasn't shipped yet is still
    // actionable ("to do today"), not a miss. Only days strictly before today
    // count as failures.
    const status: CalendarPlannedSlot["status"] =
      m.status === "miss" &&
      !m.target.informational &&
      today !== "" &&
      date >= today
        ? "upcoming"
        : m.status;
    day.plannedSlots.push({
      platform: m.target.platform,
      postType: m.target.postType,
      pillar: m.target.pillar,
      status,
      offPillar: m.offPillar,
      informational: !!m.target.informational,
      post: m.post,
    });
  }

  // Layer 2: real posts on the day they published. A post is "planned" if it
  // satisfied a slot (i.e. it is the `post` on some hit matched target).
  const plannedPostIds = new Set(
    comparison.matched
      .filter((m) => m.post)
      .map((m) => (m.post as AirtableRecord).id),
  );
  for (const p of posts) {
    const iso = str(p.fields["Published At"]);
    if (!iso) continue;
    const date = formatLocalDate(iso, timezone) || iso.slice(0, 10);
    const day = ensureDay(date);
    if (!day) continue;
    day.posts.push({
      record: p,
      platform: postPlatform(p),
      postType: postType(p),
      pillar: postPillar(p),
      planned: plannedPostIds.has(p.id),
    });
  }

  // Group days into ISO weeks.
  const weekMap = new Map<string, CalendarDay[]>();
  for (const day of dayMap.values()) {
    const key = isoWeekKey(day.date);
    const arr = weekMap.get(key);
    if (arr) arr.push(day);
    else weekMap.set(key, [day]);
  }

  const weeks: CalendarWeek[] = [...weekMap.entries()].map(([weekKey, days]) => {
    days.sort((a, b) => b.date.localeCompare(a.date)); // most-recent-first
    let planned = 0;
    let hit = 0;
    for (const d of days) {
      for (const s of d.plannedSlots) {
        if (s.informational) continue; // reminders don't count toward adherence
        if (s.status === "upcoming") continue; // not due yet — not scored
        planned += 1;
        if (s.status === "hit") hit += 1;
      }
    }
    return {
      weekKey,
      start: dateForWeekday(weekKey, "Mon"),
      end: dateForWeekday(weekKey, "Sun"),
      planned,
      hit,
      hitRate: planned > 0 ? hit / planned : 0,
      days,
    };
  });

  weeks.sort((a, b) => b.weekKey.localeCompare(a.weekKey)); // most-recent-first
  return weeks;
}
