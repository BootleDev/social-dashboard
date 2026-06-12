import { describe, it, expect } from "vitest";
import {
  parsePeakRule,
  upcomingWindows,
  buildBootleKeywordAllowlist,
  matchesBootleAllowlist,
  type SeasonalOpportunity,
} from "../seasonal";

function isoDate(d: Date): string {
  return d.toISOString().slice(0, 10);
}

describe("parsePeakRule — fixed dates", () => {
  it("MM-DD parses to a UTC date", () => {
    const d = parsePeakRule("02-14", 2027);
    expect(d).not.toBeNull();
    expect(isoDate(d!)).toBe("2027-02-14");
  });

  it("rejects invalid MM-DD", () => {
    expect(parsePeakRule("13-01", 2027)).toBeNull();
    expect(parsePeakRule("02-32", 2027)).toBeNull();
  });
});

describe("parsePeakRule — Nth weekday of month", () => {
  it("2nd-sun-may computes US Mother's Day correctly", () => {
    expect(isoDate(parsePeakRule("2nd-sun-may", 2026)!)).toBe("2026-05-10");
    expect(isoDate(parsePeakRule("2nd-sun-may", 2027)!)).toBe("2027-05-09");
    expect(isoDate(parsePeakRule("2nd-sun-may", 2028)!)).toBe("2028-05-14");
  });

  it("3rd-sun-june computes Father's Day correctly", () => {
    expect(isoDate(parsePeakRule("3rd-sun-june", 2026)!)).toBe("2026-06-21");
    expect(isoDate(parsePeakRule("3rd-sun-june", 2027)!)).toBe("2027-06-20");
  });
});

describe("parsePeakRule — last weekday of month", () => {
  it("last-fri-nov computes Black Friday correctly", () => {
    expect(isoDate(parsePeakRule("last-fri-nov", 2026)!)).toBe("2026-11-27");
    expect(isoDate(parsePeakRule("last-fri-nov", 2027)!)).toBe("2027-11-26");
  });
});

describe("parsePeakRule — easter family", () => {
  it("computes Easter correctly", () => {
    expect(isoDate(parsePeakRule("easter", 2026)!)).toBe("2026-04-05");
    expect(isoDate(parsePeakRule("easter", 2027)!)).toBe("2027-03-28");
    expect(isoDate(parsePeakRule("easter", 2025)!)).toBe("2025-04-20");
  });

  it("easter-21d = UK Mothering Sunday", () => {
    expect(isoDate(parsePeakRule("easter-21d", 2026)!)).toBe("2026-03-15");
    expect(isoDate(parsePeakRule("easter-21d", 2027)!)).toBe("2027-03-07");
  });

  it("easter+39d = Ascension Day = DE Vatertag", () => {
    expect(isoDate(parsePeakRule("easter+39d", 2026)!)).toBe("2026-05-14");
    expect(isoDate(parsePeakRule("easter+39d", 2027)!)).toBe("2027-05-06");
  });
});

describe("parsePeakRule — table lookups", () => {
  it("lunar-new-year resolves via table", () => {
    expect(isoDate(parsePeakRule("lunar-new-year", 2027)!)).toBe("2027-02-06");
  });

  it("diwali resolves via table", () => {
    expect(isoDate(parsePeakRule("diwali", 2026)!)).toBe("2026-11-08");
  });

  it("returns null for years outside the lookup table", () => {
    expect(parsePeakRule("lunar-new-year", 2099)).toBeNull();
  });
});

describe("parsePeakRule — invalid input", () => {
  it("returns null for unknown rules", () => {
    expect(parsePeakRule("groundhog-day", 2027)).toBeNull();
    expect(parsePeakRule("", 2027)).toBeNull();
    expect(parsePeakRule("not a rule", 2027)).toBeNull();
  });
});

describe("upcomingWindows", () => {
  const opps: SeasonalOpportunity[] = [
    {
      id: "1",
      name: "Black Friday",
      markets: ["Global"],
      category: "Retail-moment",
      peakRule: "last-fri-nov",
      windowEndDays: 4,
      bootleAngle: "",
      trendKeywords: ["black friday"],
      notes: "",
    },
    {
      id: "2",
      name: "Christmas",
      markets: ["Global"],
      category: "Holiday-gifting",
      peakRule: "12-20",
      windowEndDays: 5,
      bootleAngle: "",
      trendKeywords: ["christmas gift"],
      notes: "",
    },
    {
      id: "3",
      name: "Earth Day",
      markets: ["Global"],
      category: "Cultural-spike",
      peakRule: "04-22",
      windowEndDays: 7,
      bootleAngle: "",
      trendKeywords: ["earth day"],
      notes: "",
    },
  ];

  it("returns opportunities within horizon, sorted by peak", () => {
    const today = new Date(Date.UTC(2026, 10, 1)); // 2026-11-01
    const result = upcomingWindows(opps, today, 90, 4);
    expect(result.map((w) => w.opportunity.name)).toEqual([
      "Black Friday",
      "Christmas",
    ]);
    expect(result[0].daysUntilPeak).toBe(26); // 11/27 - 11/01
  });

  it("flags inWindow when within lead-time", () => {
    const today = new Date(Date.UTC(2026, 10, 1));
    const result = upcomingWindows(opps, today, 90, 4);
    const bf = result.find((w) => w.opportunity.name === "Black Friday");
    expect(bf?.inWindow).toBe(true); // 26 days <= 28 days lead
  });

  it("flags postPeak when peak passed but within tail", () => {
    const today = new Date(Date.UTC(2026, 10, 28)); // day after BF 2026-11-27
    const result = upcomingWindows(opps, today, 90, 4);
    const bf = result.find((w) => w.opportunity.name === "Black Friday");
    expect(bf).toBeDefined();
    expect(bf?.postPeak).toBe(true);
    expect(bf?.inWindow).toBe(true);
  });

  it("rolls forward to next year if this year's peak + tail has passed", () => {
    const today = new Date(Date.UTC(2026, 11, 26)); // 2026-12-26, post-Christmas tail
    const result = upcomingWindows(opps, today, 365, 4);
    const xmas = result.find((w) => w.opportunity.name === "Christmas");
    expect(xmas?.peak.getUTCFullYear()).toBe(2027);
  });
});

describe("buildBootleKeywordAllowlist", () => {
  it("merges seasonal keywords with content pillars", () => {
    const opps: SeasonalOpportunity[] = [
      {
        id: "1",
        name: "BF",
        markets: ["Global"],
        category: "Retail-moment",
        peakRule: "last-fri-nov",
        windowEndDays: 0,
        bootleAngle: "",
        trendKeywords: ["holiday gift guide", "christmas"],
        notes: "",
      },
    ];
    const allowlist = buildBootleKeywordAllowlist(opps);
    expect(allowlist).toContain("water bottle");
    expect(allowlist).toContain("hydration");
    expect(allowlist).toContain("holiday gift guide");
    expect(allowlist).toContain("christmas");
  });
});

describe("matchesBootleAllowlist", () => {
  const allowlist = [
    "water bottle",
    "hydration",
    "tea",
    "matcha",
    "wedding gift",
    "graduation gift",
    // generic aesthetic adjacencies — drinkware co-occurs with these, but they
    // are NOT relevant on their own.
    "outfit",
    "aesthetic",
    "essentials",
    "kitchen",
  ];

  it("matches on a strong (drinkware/wellness/gifting) signal", () => {
    expect(matchesBootleAllowlist("WATER BOTTLE", allowlist)).toBe(true);
    expect(matchesBootleAllowlist("hydration tracker", allowlist)).toBe(true);
    expect(matchesBootleAllowlist("matcha latte recipe", allowlist)).toBe(true);
    expect(matchesBootleAllowlist("wedding gift ideas", allowlist)).toBe(true);
    expect(matchesBootleAllowlist("graduation party ideas", allowlist)).toBe(
      true,
    );
    expect(matchesBootleAllowlist("wedding", allowlist)).toBe(true);
  });

  it("matches a generic token ONLY when a strong signal co-occurs", () => {
    // "water bottle aesthetic" — strong "water bottle" present.
    expect(matchesBootleAllowlist("water bottle aesthetic", allowlist)).toBe(
      true,
    );
  });

  it("rejects keywords that hit ONLY a generic aesthetic token (the bug)", () => {
    // These are the real 2026-06-04 false positives: a single weak token
    // ("outfit"/"aesthetic") let pop-culture and nail-art noise through.
    expect(
      matchesBootleAllowlist("harry styles concert outfit", allowlist),
    ).toBe(false);
    expect(matchesBootleAllowlist("michael jackson aesthetic", allowlist)).toBe(
      false,
    );
    expect(matchesBootleAllowlist("summer outfits for men", allowlist)).toBe(
      false,
    );
    expect(matchesBootleAllowlist("kitchen aesthetic", allowlist)).toBe(false);
  });

  it("rejects clearly unrelated keywords", () => {
    expect(matchesBootleAllowlist("michael jackson", allowlist)).toBe(false);
    expect(matchesBootleAllowlist("crypto memes", allowlist)).toBe(false);
    expect(
      matchesBootleAllowlist("tomodachi life island layout", allowlist),
    ).toBe(false);
    expect(matchesBootleAllowlist("ibiza nails summer", allowlist)).toBe(false);
  });

  it("rejects noise that shares only an event/context word with a strong entry", () => {
    // Real 2026-06-04 leaks: these slipped through by sharing a single
    // event-context token ("festival", "black", "summer") with a multi-word
    // allowlist entry like "festival outfit" / "black friday gift" /
    // "summer wedding". Context words are not core relevance signals.
    const ctxAllow = [
      "festival outfit",
      "festival essentials",
      "black friday gift",
      "summer wedding",
      "college dorm essentials",
    ];
    expect(matchesBootleAllowlist("festival nails", ctxAllow)).toBe(false);
    expect(matchesBootleAllowlist("black noir", ctxAllow)).toBe(false);
    expect(
      matchesBootleAllowlist("michael jackson black and white", ctxAllow),
    ).toBe(false);
    expect(matchesBootleAllowlist("summer outfits for men", ctxAllow)).toBe(
      false,
    );
    // …but the genuine gifting/wedding phrases still match.
    expect(matchesBootleAllowlist("wedding gift ideas", ctxAllow)).toBe(true);
    expect(matchesBootleAllowlist("black friday gift guide", ctxAllow)).toBe(
      true,
    );
  });

  it("admits gift-giving OCCASIONS even without the literal word 'gift'", () => {
    // The core-token set originally only knew the word "gift" plus a few named
    // events, so it missed the occasions that IMPLY gifting — where drinkware
    // is a natural present. These are real US Pinterest trends (2026-06-05)
    // that were being rejected.
    expect(matchesBootleAllowlist("mothers day gifts", allowlist)).toBe(true);
    expect(matchesBootleAllowlist("happy mothers day", allowlist)).toBe(true);
    expect(matchesBootleAllowlist("fathers day ideas", allowlist)).toBe(true);
    expect(matchesBootleAllowlist("teacher appreciation gifts", allowlist)).toBe(
      true,
    );
    expect(matchesBootleAllowlist("happy birthday", allowlist)).toBe(true);
    expect(matchesBootleAllowlist("anniversary ideas", allowlist)).toBe(true);
    expect(matchesBootleAllowlist("housewarming party", allowlist)).toBe(true);
    expect(matchesBootleAllowlist("valentines day", allowlist)).toBe(true);
  });

  it("still rejects food/recipe noise after the occasion widening", () => {
    // Widening occasions must NOT pull in lifestyle/food noise. "recipe" stays
    // generic; these have no gifting/drinkware/wellness anchor.
    expect(matchesBootleAllowlist("banana bread recipe", allowlist)).toBe(false);
    expect(matchesBootleAllowlist("easy dinner recipes", allowlist)).toBe(false);
    expect(matchesBootleAllowlist("rhubarb sauce recipes", allowlist)).toBe(
      false,
    );
    expect(matchesBootleAllowlist("erdbeer spargel salat", allowlist)).toBe(
      false,
    );
  });
});
