import { describe, it, expect } from "vitest";
import {
  parseContentPlan,
  isoWeekKey,
  weekKeysInRange,
  expandTargets,
  comparePlanToActual,
  filterPlanPlatforms,
  dateForWeekday,
  buildCalendar,
  type ContentPlan,
} from "../contentPlan";
import type { AirtableRecord } from "../utils";

// ── helpers ────────────────────────────────────────────────────────────────

function post(
  fields: Partial<{
    platform: string;
    postType: string;
    pillar: string;
    publishedAt: string;
  }>,
  id = Math.random().toString(36).slice(2),
): AirtableRecord {
  return {
    id,
    createdTime: "",
    fields: {
      Platform: fields.platform ?? "instagram",
      "Post Type": fields.postType ?? "reel",
      "Content Pillar": fields.pillar ?? "",
      "Published At": fields.publishedAt ?? "",
    },
  };
}

const BASE_PLAN: ContentPlan = {
  effectiveFrom: "2026-05-01",
  weekly: [
    { day: "Mon", platform: "instagram", postType: "reel", pillar: "Drink recipe" },
    { day: "Fri", platform: "instagram", postType: "static", pillar: "Design" },
  ],
  monthlyPillarMix: { "Drink recipe": 0.5, Design: 0.5 },
  overrides: [],
};

// ── parseContentPlan ─────────────────────────────────────────────────────────

describe("parseContentPlan", () => {
  it("parses a valid config and lowercases platform/postType", () => {
    const plan = parseContentPlan({
      effectiveFrom: "2026-05-01",
      weekly: [{ day: "Mon", platform: "Instagram", postType: "REEL", pillar: "Design" }],
      overrides: [],
    });
    expect(plan.weekly[0].platform).toBe("instagram");
    expect(plan.weekly[0].postType).toBe("reel");
    expect(plan.weekly[0].pillar).toBe("Design");
  });

  it("treats missing pillar as undefined (pillar-agnostic slot)", () => {
    const plan = parseContentPlan({
      effectiveFrom: "2026-05-01",
      weekly: [{ day: "Tue", platform: "instagram", postType: "carousel" }],
      overrides: [],
    });
    expect(plan.weekly[0].pillar).toBeUndefined();
  });

  it("rejects a bad effectiveFrom", () => {
    expect(() => parseContentPlan({ effectiveFrom: "May 2026", weekly: [], overrides: [] })).toThrow(
      /effectiveFrom/,
    );
  });

  it("rejects an invalid day label", () => {
    expect(() =>
      parseContentPlan({
        effectiveFrom: "2026-05-01",
        weekly: [{ day: "Funday", platform: "instagram", postType: "reel" }],
        overrides: [],
      }),
    ).toThrow(/day/);
  });

  it("rejects a slot missing platform", () => {
    expect(() =>
      parseContentPlan({
        effectiveFrom: "2026-05-01",
        weekly: [{ day: "Mon", platform: "", postType: "reel" }],
        overrides: [],
      }),
    ).toThrow(/platform/);
  });

  it("allows a slot with no postType (wildcard)", () => {
    const plan = parseContentPlan({
      effectiveFrom: "2026-05-01",
      weekly: [{ day: "Mon", platform: "pinterest" }],
      overrides: [],
    });
    expect(plan.weekly[0].postType).toBeUndefined();
    expect(plan.weekly[0].platform).toBe("pinterest");
  });

  it("validates override dates", () => {
    expect(() =>
      parseContentPlan({
        effectiveFrom: "2026-05-01",
        weekly: [],
        overrides: [{ day: "Wed", platform: "instagram", postType: "reel", date: "nope" }],
      }),
    ).toThrow(/date/);
  });

  it("drops non-positive pillar-mix weights", () => {
    const plan = parseContentPlan({
      effectiveFrom: "2026-05-01",
      weekly: [],
      overrides: [],
      monthlyPillarMix: { Design: 0.4, Modularity: 0, Bad: -1 },
    });
    expect(plan.monthlyPillarMix).toEqual({ Design: 0.4 });
  });

  it("throws on non-object input", () => {
    expect(() => parseContentPlan(null)).toThrow();
    expect(() => parseContentPlan(42)).toThrow();
  });
});

// ── isoWeekKey ───────────────────────────────────────────────────────────────

describe("isoWeekKey", () => {
  it("assigns the same week to Mon..Sun of one ISO week", () => {
    // 2026-05-25 is a Monday; the week runs through Sun 2026-05-31.
    const mon = isoWeekKey("2026-05-25");
    expect(isoWeekKey("2026-05-31")).toBe(mon);
    expect(mon).toMatch(/^2026-W\d{2}$/);
  });

  it("rolls to the next week on the following Monday", () => {
    expect(isoWeekKey("2026-06-01")).not.toBe(isoWeekKey("2026-05-31"));
  });

  it("handles the year boundary (Jan 1 belongs to prior ISO year)", () => {
    // 2027-01-01 is a Friday; ISO week 53 of 2026.
    expect(isoWeekKey("2027-01-01")).toBe("2026-W53");
  });

  it("returns empty string for a malformed date", () => {
    expect(isoWeekKey("")).toBe("");
    expect(isoWeekKey("2026-13")).toBe("");
  });
});

// ── weekKeysInRange ──────────────────────────────────────────────────────────

describe("weekKeysInRange", () => {
  it("returns one key per ISO week spanned", () => {
    const keys = weekKeysInRange("2026-05-04", "2026-05-24"); // 3 full weeks
    expect(keys.length).toBe(3);
    expect(new Set(keys).size).toBe(3);
  });

  it("includes the trailing partial week", () => {
    const keys = weekKeysInRange("2026-05-25", "2026-06-02");
    expect(keys).toContain(isoWeekKey("2026-06-02"));
  });

  it("returns [] for an inverted range", () => {
    expect(weekKeysInRange("2026-05-10", "2026-05-01")).toEqual([]);
  });
});

// ── expandTargets ────────────────────────────────────────────────────────────

describe("expandTargets", () => {
  it("instantiates each weekly slot per week in range", () => {
    const targets = expandTargets(BASE_PLAN, { start: "2026-05-04", end: "2026-05-17" });
    // 2 weeks × 2 slots
    expect(targets.length).toBe(4);
    expect(targets.every((t) => !t.fromOverride)).toBe(true);
  });

  it("skips weeks before effectiveFrom", () => {
    const plan = { ...BASE_PLAN, effectiveFrom: "2026-05-11" };
    const targets = expandTargets(plan, { start: "2026-05-04", end: "2026-05-17" });
    // Only the week of May 11 qualifies -> 2 slots.
    expect(targets.length).toBe(2);
  });

  it("adds override slots that fall inside the range", () => {
    const plan: ContentPlan = {
      ...BASE_PLAN,
      overrides: [
        { day: "Wed", platform: "instagram", postType: "carousel", date: "2026-05-06" },
      ],
    };
    const targets = expandTargets(plan, { start: "2026-05-04", end: "2026-05-10" });
    expect(targets.some((t) => t.fromOverride && t.postType === "carousel")).toBe(true);
  });
});

// ── comparePlanToActual ──────────────────────────────────────────────────────

describe("comparePlanToActual", () => {
  const range = { start: "2026-05-04", end: "2026-05-10" }; // one ISO week (Mon 5/4)

  it("counts a hit when platform + post type match in the same week", () => {
    const posts = [
      post({ platform: "instagram", postType: "reel", publishedAt: "2026-05-04T09:00:00Z" }),
      post({ platform: "instagram", postType: "static", publishedAt: "2026-05-08T09:00:00Z" }),
    ];
    const r = comparePlanToActual(BASE_PLAN, posts, range, "UTC");
    expect(r.totals.planned).toBe(2);
    expect(r.totals.hit).toBe(2);
    expect(r.totals.missed).toBe(0);
    expect(r.totals.hitRate).toBe(1);
    expect(r.totals.unplanned).toBe(0);
  });

  it("counts a miss when no matching post exists that week", () => {
    const posts = [
      post({ platform: "instagram", postType: "reel", publishedAt: "2026-05-04T09:00:00Z" }),
      // no static post
    ];
    const r = comparePlanToActual(BASE_PLAN, posts, range, "UTC");
    expect(r.totals.hit).toBe(1);
    expect(r.totals.missed).toBe(1);
    expect(r.matched.find((m) => m.target.postType === "static")?.status).toBe("miss");
  });

  it("matches within the ISO week regardless of day-of-week", () => {
    // Plan slot is Mon reel; post lands Saturday — still the same ISO week.
    const posts = [
      post({ platform: "instagram", postType: "reel", publishedAt: "2026-05-09T09:00:00Z" }),
    ];
    const r = comparePlanToActual(BASE_PLAN, posts, range, "UTC");
    expect(r.matched.find((m) => m.target.postType === "reel")?.status).toBe("hit");
  });

  it("flags a hit as offPillar when the post pillar differs from the slot", () => {
    const posts = [
      post({
        platform: "instagram",
        postType: "reel",
        pillar: "Modularity", // slot wants Drink recipe
        publishedAt: "2026-05-04T09:00:00Z",
      }),
    ];
    const r = comparePlanToActual(BASE_PLAN, posts, range, "UTC");
    const m = r.matched.find((m) => m.target.postType === "reel");
    expect(m?.status).toBe("hit");
    expect(m?.offPillar).toBe(true);
    expect(r.totals.offPillar).toBe(1);
  });

  it("does not flag offPillar when the post has no pillar tagged", () => {
    const posts = [
      post({ platform: "instagram", postType: "reel", pillar: "", publishedAt: "2026-05-04T09:00:00Z" }),
    ];
    const r = comparePlanToActual(BASE_PLAN, posts, range, "UTC");
    expect(r.totals.offPillar).toBe(0);
  });

  it("treats extra posts beyond planned slots as unplanned", () => {
    const posts = [
      post({ platform: "instagram", postType: "reel", publishedAt: "2026-05-04T09:00:00Z" }),
      post({ platform: "instagram", postType: "reel", publishedAt: "2026-05-05T09:00:00Z" }), // 2nd reel
    ];
    const r = comparePlanToActual(BASE_PLAN, posts, range, "UTC");
    // One reel hits the single reel slot; the second is unplanned.
    expect(r.totals.unplanned).toBe(1);
  });

  it("consumes each post at most once (greedy)", () => {
    const plan: ContentPlan = {
      effectiveFrom: "2026-05-01",
      weekly: [
        { day: "Mon", platform: "instagram", postType: "reel" },
        { day: "Thu", platform: "instagram", postType: "reel" },
      ],
      overrides: [],
    };
    const posts = [
      post({ platform: "instagram", postType: "reel", publishedAt: "2026-05-04T09:00:00Z" }),
    ];
    const r = comparePlanToActual(plan, posts, range, "UTC");
    expect(r.totals.hit).toBe(1);
    expect(r.totals.missed).toBe(1); // second reel slot has no post left
    expect(r.totals.unplanned).toBe(0);
  });

  it("aggregates per-week adherence oldest-first", () => {
    const posts = [
      post({ platform: "instagram", postType: "reel", publishedAt: "2026-05-04T09:00:00Z" }),
      post({ platform: "instagram", postType: "reel", publishedAt: "2026-05-11T09:00:00Z" }),
    ];
    const r = comparePlanToActual(BASE_PLAN, posts, { start: "2026-05-04", end: "2026-05-17" }, "UTC");
    expect(r.perWeek.length).toBe(2);
    expect(r.perWeek[0].weekKey < r.perWeek[1].weekKey).toBe(true);
  });

  it("ranks per-slot miss rate worst-first", () => {
    const posts = [
      post({ platform: "instagram", postType: "reel", publishedAt: "2026-05-04T09:00:00Z" }),
      // static slot never filled -> 100% miss
    ];
    const r = comparePlanToActual(BASE_PLAN, posts, range, "UTC");
    expect(r.perSlot[0].postType).toBe("static");
    expect(r.perSlot[0].missRate).toBe(1);
  });

  it("computes planned vs actual pillar mix", () => {
    const posts = [
      post({ platform: "instagram", postType: "reel", pillar: "Drink recipe", publishedAt: "2026-05-04T09:00:00Z" }),
      post({ platform: "instagram", postType: "static", pillar: "Drink recipe", publishedAt: "2026-05-08T09:00:00Z" }),
    ];
    const r = comparePlanToActual(BASE_PLAN, posts, range, "UTC");
    const recipe = r.pillarMix.find((p) => p.pillar === "Drink recipe");
    const design = r.pillarMix.find((p) => p.pillar === "Design");
    expect(recipe?.planned).toBe(0.5);
    expect(recipe?.actual).toBe(1); // both tagged posts are Drink recipe
    expect(design?.planned).toBe(0.5);
    expect(design?.actual).toBe(0);
  });

  it("returns zeroed totals when nothing is planned in range", () => {
    const plan = { ...BASE_PLAN, effectiveFrom: "2027-01-01" };
    const r = comparePlanToActual(plan, [], range, "UTC");
    expect(r.totals.planned).toBe(0);
    expect(r.totals.hitRate).toBe(0);
  });

  it("a wildcard slot (no postType) matches any post type on the platform", () => {
    const plan: ContentPlan = {
      effectiveFrom: "2026-05-01",
      weekly: [{ day: "Mon", platform: "pinterest" }], // wildcard
      overrides: [],
    };
    // Pinterest pins are stored as 'static' / 'video', never 'pin'.
    const staticPin = comparePlanToActual(
      plan,
      [post({ platform: "pinterest", postType: "static", publishedAt: "2026-05-04T09:00:00Z" })],
      range,
      "UTC",
    );
    expect(staticPin.totals.hit).toBe(1);
    expect(staticPin.totals.unplanned).toBe(0);

    const videoPin = comparePlanToActual(
      plan,
      [post({ platform: "pinterest", postType: "video", publishedAt: "2026-05-05T09:00:00Z" })],
      range,
      "UTC",
    );
    expect(videoPin.totals.hit).toBe(1);
  });

  it("a wildcard slot still requires the platform to match", () => {
    const plan: ContentPlan = {
      effectiveFrom: "2026-05-01",
      weekly: [{ day: "Mon", platform: "pinterest" }],
      overrides: [],
    };
    const r = comparePlanToActual(
      plan,
      [post({ platform: "instagram", postType: "static", publishedAt: "2026-05-04T09:00:00Z" })],
      range,
      "UTC",
    );
    expect(r.totals.hit).toBe(0);
    expect(r.totals.missed).toBe(1);
    expect(r.totals.unplanned).toBe(1); // the IG post matches no slot
  });

  it("informational slots are excluded from all adherence counts", () => {
    const plan: ContentPlan = {
      effectiveFrom: "2026-05-01",
      weekly: [
        { day: "Mon", platform: "instagram", postType: "reel" },
        { day: "Mon", platform: "instagram", postType: "story", informational: true },
      ],
      overrides: [],
    };
    // Only the reel ships; the story slot must not count as a miss.
    const r = comparePlanToActual(
      plan,
      [post({ platform: "instagram", postType: "reel", publishedAt: "2026-05-04T09:00:00Z" })],
      range,
      "UTC",
    );
    expect(r.totals.planned).toBe(1); // reel only, story excluded
    expect(r.totals.hit).toBe(1);
    expect(r.totals.missed).toBe(0); // story miss does NOT count
    expect(r.totals.hitRate).toBe(1);
    // perSlot should not contain the story slot.
    expect(r.perSlot.some((s) => s.postType === "story")).toBe(false);
  });

  it("an informational slot never consumes a post", () => {
    const plan: ContentPlan = {
      effectiveFrom: "2026-05-01",
      weekly: [
        { day: "Mon", platform: "instagram", informational: true }, // wildcard + informational
        { day: "Wed", platform: "instagram", postType: "reel" },
      ],
      overrides: [],
    };
    const r = comparePlanToActual(
      plan,
      [post({ platform: "instagram", postType: "reel", publishedAt: "2026-05-04T09:00:00Z" })],
      range,
      "UTC",
    );
    // The reel must satisfy the reel slot, not be eaten by the informational one.
    expect(r.totals.hit).toBe(1);
    expect(r.totals.unplanned).toBe(0);
  });
});

describe("buildCalendar — informational slots", () => {
  const range = { start: "2026-05-04", end: "2026-05-10" };

  it("renders informational slots but excludes them from week counts", () => {
    const plan: ContentPlan = {
      effectiveFrom: "2026-05-01",
      weekly: [
        { day: "Mon", platform: "instagram", postType: "reel" },
        { day: "Tue", platform: "instagram", postType: "story", informational: true },
      ],
      overrides: [],
    };
    const weeks = buildCalendar(plan, [], range, "UTC");
    const wk = weeks[0];
    // Week planned count = scored slots only (the reel), not the story.
    expect(wk.planned).toBe(1);
    // But the story slot is still present on the calendar for display.
    const allSlots = wk.days.flatMap((d) => d.plannedSlots);
    const story = allSlots.find((s) => s.postType === "story");
    expect(story).toBeDefined();
    expect(story?.informational).toBe(true);
  });
});

describe("buildCalendar — upcoming vs miss (today-aware)", () => {
  // BASE_PLAN: Mon reel (2026-05-04), Fri static (2026-05-08) in week 2026-W19.
  const range = { start: "2026-05-04", end: "2026-05-10" };

  it("marks an unshipped slot whose day is AFTER today as 'upcoming', not 'miss'", () => {
    // Today is Wed 2026-05-06: Mon already passed (miss), Fri is ahead (upcoming).
    const weeks = buildCalendar(BASE_PLAN, [], range, "UTC", "2026-05-06");
    const wk = weeks[0];
    const mon = wk.days.find((d) => d.date === "2026-05-04")!;
    const fri = wk.days.find((d) => d.date === "2026-05-08")!;
    expect(mon.plannedSlots[0].status).toBe("miss"); // past, unshipped
    expect(fri.plannedSlots[0].status).toBe("upcoming"); // future, unshipped
  });

  it("treats a slot whose day IS today as upcoming (still actionable, not a failure)", () => {
    const weeks = buildCalendar(BASE_PLAN, [], range, "UTC", "2026-05-08");
    const wk = weeks[0];
    const fri = wk.days.find((d) => d.date === "2026-05-08")!;
    expect(fri.plannedSlots[0].status).toBe("upcoming");
  });

  it("a shipped slot is 'hit' regardless of today", () => {
    const posts = [
      post({ platform: "instagram", postType: "reel", publishedAt: "2026-05-04T09:00:00Z" }),
    ];
    const weeks = buildCalendar(BASE_PLAN, posts, range, "UTC", "2026-05-06");
    const wk = weeks[0];
    const mon = wk.days.find((d) => d.date === "2026-05-04")!;
    expect(mon.plannedSlots.find((s) => s.postType === "reel")?.status).toBe("hit");
  });

  it("upcoming slots do NOT count as misses in week adherence", () => {
    // Today Wed: Fri static is upcoming. Week planned should drop the upcoming
    // slot from the denominator so the hit rate isn't artificially deflated.
    const posts = [
      post({ platform: "instagram", postType: "reel", publishedAt: "2026-05-04T09:00:00Z" }),
    ];
    const weeks = buildCalendar(BASE_PLAN, posts, range, "UTC", "2026-05-06");
    const wk = weeks[0];
    // Only the past reel slot is scored (hit); the future static slot is pending.
    expect(wk.planned).toBe(1);
    expect(wk.hit).toBe(1);
    expect(wk.hitRate).toBe(1);
    // The upcoming slot is still present for display.
    const fri = wk.days.find((d) => d.date === "2026-05-08")!;
    expect(fri.plannedSlots[0].status).toBe("upcoming");
  });

  it("with no `today` passed, all unshipped slots remain 'miss' (backward compatible)", () => {
    const weeks = buildCalendar(BASE_PLAN, [], range, "UTC");
    const wk = weeks[0];
    for (const d of wk.days) {
      for (const s of d.plannedSlots) {
        expect(s.status).toBe("miss");
      }
    }
  });

  it("an upcoming informational slot stays informational and unscored", () => {
    const plan: ContentPlan = {
      effectiveFrom: "2026-05-01",
      weekly: [{ day: "Fri", platform: "instagram", postType: "story", informational: true }],
      overrides: [],
    };
    const weeks = buildCalendar(plan, [], range, "UTC", "2026-05-06");
    const wk = weeks[0];
    expect(wk.planned).toBe(0); // informational never scored
    const fri = wk.days.find((d) => d.date === "2026-05-08")!;
    expect(fri.plannedSlots[0].informational).toBe(true);
  });
});

// ── dateForWeekday ───────────────────────────────────────────────────────────

describe("dateForWeekday", () => {
  it("round-trips with isoWeekKey for each weekday", () => {
    // 2026-05-25 is a Monday -> its ISO week.
    const wk = isoWeekKey("2026-05-25");
    expect(dateForWeekday(wk, "Mon")).toBe("2026-05-25");
    expect(dateForWeekday(wk, "Fri")).toBe("2026-05-29");
    expect(dateForWeekday(wk, "Sun")).toBe("2026-05-31");
  });

  it("every resolved date maps back to the same week key", () => {
    const wk = isoWeekKey("2026-05-25");
    for (const d of ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"] as const) {
      expect(isoWeekKey(dateForWeekday(wk, d))).toBe(wk);
    }
  });

  it("handles the ISO year boundary (2026-W53)", () => {
    // 2027-01-01 is a Friday in ISO week 2026-W53.
    expect(dateForWeekday("2026-W53", "Fri")).toBe("2027-01-01");
  });

  it("returns empty string for a malformed week key", () => {
    expect(dateForWeekday("nope", "Mon")).toBe("");
  });
});

// ── buildCalendar ────────────────────────────────────────────────────────────

describe("buildCalendar", () => {
  const range = { start: "2026-05-04", end: "2026-05-17" }; // two ISO weeks

  it("groups days into weeks, most-recent week first", () => {
    const weeks = buildCalendar(BASE_PLAN, [], range, "UTC");
    expect(weeks.length).toBe(2);
    expect(weeks[0].weekKey > weeks[1].weekKey).toBe(true);
  });

  it("orders days within a week most-recent-first", () => {
    const posts = [
      post({ platform: "instagram", postType: "reel", publishedAt: "2026-05-04T09:00:00Z" }),
      post({ platform: "instagram", postType: "static", publishedAt: "2026-05-08T09:00:00Z" }),
    ];
    const weeks = buildCalendar(BASE_PLAN, posts, range, "UTC");
    const wk = weeks.find((w) => w.weekKey === isoWeekKey("2026-05-04"))!;
    const dates = wk.days.map((d) => d.date);
    const sorted = [...dates].sort().reverse();
    expect(dates).toEqual(sorted);
  });

  it("anchors a planned slot to its target weekday and marks miss", () => {
    const weeks = buildCalendar(BASE_PLAN, [], range, "UTC");
    const wk = weeks.find((w) => w.weekKey === isoWeekKey("2026-05-04"))!;
    // Mon reel slot -> 2026-05-04; Fri static -> 2026-05-08.
    const mon = wk.days.find((d) => d.date === "2026-05-04")!;
    expect(mon.plannedSlots[0].postType).toBe("reel");
    expect(mon.plannedSlots[0].status).toBe("miss");
  });

  it("places a real post on its publish day and marks it planned when it fills a slot", () => {
    const posts = [
      post({ platform: "instagram", postType: "reel", publishedAt: "2026-05-04T09:00:00Z" }),
    ];
    const weeks = buildCalendar(BASE_PLAN, posts, range, "UTC");
    const wk = weeks.find((w) => w.weekKey === isoWeekKey("2026-05-04"))!;
    const mon = wk.days.find((d) => d.date === "2026-05-04")!;
    expect(mon.posts.length).toBe(1);
    expect(mon.posts[0].planned).toBe(true);
    expect(mon.plannedSlots.find((s) => s.postType === "reel")?.status).toBe("hit");
  });

  it("tags an extra post as unplanned", () => {
    const posts = [
      post({ platform: "instagram", postType: "video", publishedAt: "2026-05-06T09:00:00Z" }),
    ];
    const weeks = buildCalendar(BASE_PLAN, posts, range, "UTC");
    const wk = weeks.find((w) => w.weekKey === isoWeekKey("2026-05-04"))!;
    const wed = wk.days.find((d) => d.date === "2026-05-06")!;
    expect(wed.posts[0].planned).toBe(false);
  });

  it("computes per-week planned/hit/hitRate", () => {
    const posts = [
      post({ platform: "instagram", postType: "reel", publishedAt: "2026-05-04T09:00:00Z" }),
    ];
    const weeks = buildCalendar(BASE_PLAN, posts, range, "UTC");
    const wk = weeks.find((w) => w.weekKey === isoWeekKey("2026-05-04"))!;
    expect(wk.planned).toBe(2); // reel + static
    expect(wk.hit).toBe(1);
    expect(wk.hitRate).toBe(0.5);
  });

  it("excludes days outside the range", () => {
    const posts = [
      post({ platform: "instagram", postType: "reel", publishedAt: "2026-04-30T09:00:00Z" }),
    ];
    const weeks = buildCalendar(BASE_PLAN, posts, range, "UTC");
    const allDates = weeks.flatMap((w) => w.days.map((d) => d.date));
    expect(allDates.every((d) => d >= range.start && d <= range.end)).toBe(true);
  });
});

// ── filterPlanPlatforms ──────────────────────────────────────────────────────

describe("filterPlanPlatforms", () => {
  const MULTI_PLAN: ContentPlan = {
    effectiveFrom: "2026-05-01",
    weekly: [
      { day: "Mon", platform: "instagram", postType: "reel" },
      { day: "Tue", platform: "pinterest" },
      { day: "Wed", platform: "facebook", postType: "video" },
    ],
    overrides: [
      { date: "2026-06-05", day: "Fri", platform: "pinterest" },
      { date: "2026-06-06", day: "Sat", platform: "instagram", postType: "static" },
    ],
  };

  it("returns the plan unchanged for an empty selection (= all platforms)", () => {
    const out = filterPlanPlatforms(MULTI_PLAN, new Set());
    expect(out.weekly).toHaveLength(3);
    expect(out.overrides).toHaveLength(2);
  });

  it("returns fresh, non-shared arrays even for an empty selection", () => {
    // The all-platforms path must still hand back arrays the caller owns, so
    // a downstream mutation can never reach back into the source plan.
    const out = filterPlanPlatforms(MULTI_PLAN, new Set());
    expect(out.weekly).not.toBe(MULTI_PLAN.weekly);
    expect(out.overrides).not.toBe(MULTI_PLAN.overrides);
  });

  it("keeps only the selected platforms' weekly slots and overrides", () => {
    const out = filterPlanPlatforms(MULTI_PLAN, new Set(["instagram"]));
    expect(out.weekly.map((s) => s.platform)).toEqual(["instagram"]);
    expect(out.overrides.map((s) => s.platform)).toEqual(["instagram"]);
  });

  it("supports multi-platform selections", () => {
    const out = filterPlanPlatforms(
      MULTI_PLAN,
      new Set(["pinterest", "facebook"]),
    );
    expect(out.weekly.map((s) => s.platform).sort()).toEqual([
      "facebook",
      "pinterest",
    ]);
  });

  it("does not mutate the input plan", () => {
    filterPlanPlatforms(MULTI_PLAN, new Set(["instagram"]));
    expect(MULTI_PLAN.weekly).toHaveLength(3);
    expect(MULTI_PLAN.overrides).toHaveLength(2);
  });
});

// ── comparePlanToActual: perPlatform rollup ─────────────────────────────────

describe("comparePlanToActual — perPlatform", () => {
  // 2026-06-01 is a Monday; week 2026-W23. Next week starts 2026-06-08 (W24).
  const PLAN: ContentPlan = {
    effectiveFrom: "2026-05-01",
    weekly: [
      { day: "Mon", platform: "instagram", postType: "reel" },
      { day: "Wed", platform: "instagram", postType: "carousel" },
      { day: "Tue", platform: "pinterest" },
      // Informational slots must never count toward any platform's numbers.
      { day: "Thu", platform: "instagram", postType: "story", informational: true },
    ],
    overrides: [],
  };

  it("rolls up planned/hit/missed and hitRate per platform", () => {
    const posts = [
      post({ platform: "instagram", postType: "reel", publishedAt: "2026-06-01T10:00:00.000Z" }),
      post({ platform: "pinterest", postType: "static", publishedAt: "2026-06-02T10:00:00.000Z" }),
    ];
    const r = comparePlanToActual(PLAN, posts, {
      start: "2026-06-01",
      end: "2026-06-07",
    });

    const ig = r.perPlatform.find((p) => p.platform === "instagram")!;
    expect(ig.planned).toBe(2); // reel + carousel; the story slot is informational
    expect(ig.hit).toBe(1);
    expect(ig.missed).toBe(1);
    expect(ig.hitRate).toBeCloseTo(0.5, 6);

    const pin = r.perPlatform.find((p) => p.platform === "pinterest")!;
    expect(pin.planned).toBe(1);
    expect(pin.hit).toBe(1);
    expect(pin.hitRate).toBe(1);
  });

  it("counts unplanned posts per platform, including platforms with no slots", () => {
    const posts = [
      post({ platform: "instagram", postType: "reel", publishedAt: "2026-06-01T10:00:00.000Z" }),
      post({ platform: "instagram", postType: "reel", publishedAt: "2026-06-02T10:00:00.000Z" }),
      post({ platform: "facebook", postType: "video", publishedAt: "2026-06-03T10:00:00.000Z" }),
    ];
    const r = comparePlanToActual(PLAN, posts, {
      start: "2026-06-01",
      end: "2026-06-07",
    });

    const ig = r.perPlatform.find((p) => p.platform === "instagram")!;
    expect(ig.unplanned).toBe(1); // second reel exceeds the single reel slot

    // Facebook has no plan slots but shipped a post: it must still appear.
    const fb = r.perPlatform.find((p) => p.platform === "facebook")!;
    expect(fb.planned).toBe(0);
    expect(fb.unplanned).toBe(1);
    expect(fb.hitRate).toBe(0);
  });

  it("provides a per-week adherence series for each platform", () => {
    const posts = [
      // IG hits its Mon reel in W23 only; W24 is a full IG miss.
      post({ platform: "instagram", postType: "reel", publishedAt: "2026-06-01T10:00:00.000Z" }),
      // Pinterest hits both weeks.
      post({ platform: "pinterest", postType: "static", publishedAt: "2026-06-02T10:00:00.000Z" }),
      post({ platform: "pinterest", postType: "video", publishedAt: "2026-06-09T10:00:00.000Z" }),
    ];
    const r = comparePlanToActual(PLAN, posts, {
      start: "2026-06-01",
      end: "2026-06-14",
    });

    const ig = r.perPlatform.find((p) => p.platform === "instagram")!;
    expect(ig.perWeek).toHaveLength(2);
    expect(ig.perWeek[0].hit).toBe(1);
    expect(ig.perWeek[0].planned).toBe(2);
    expect(ig.perWeek[1].hit).toBe(0);

    const pin = r.perPlatform.find((p) => p.platform === "pinterest")!;
    expect(pin.perWeek.map((w) => w.hitRate)).toEqual([1, 1]);
  });

  it("orders platforms by planned volume descending, then name", () => {
    const r = comparePlanToActual(PLAN, [], {
      start: "2026-06-01",
      end: "2026-06-07",
    });
    expect(r.perPlatform.map((p) => p.platform)).toEqual([
      "instagram",
      "pinterest",
    ]);
  });
});
