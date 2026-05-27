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
    "summer essentials",
    "tea",
    "wedding gift",
    "graduation gift",
    "kitchen",
  ];

  it("direct substring (allowlist inside keyword)", () => {
    expect(matchesBootleAllowlist("Summer Essentials 2027", allowlist)).toBe(true);
    expect(matchesBootleAllowlist("WATER BOTTLE", allowlist)).toBe(true);
  });

  it("reverse substring (keyword inside allowlist)", () => {
    // "tea" allowlist matches single-word trending "tea" via direct hit;
    // here we test the reverse direction explicitly.
    expect(matchesBootleAllowlist("wedding", allowlist)).toBe(true);
  });

  it("token overlap matches partial real-world cases", () => {
    // The bug that motivated this change: real 2026-05-27 GB+IE snapshot.
    expect(matchesBootleAllowlist("graduation party ideas", allowlist)).toBe(true);
    expect(matchesBootleAllowlist("wedding dresses", allowlist)).toBe(true);
    expect(matchesBootleAllowlist("kitchen aesthetic", allowlist)).toBe(true);
  });

  it("ignores short common tokens to avoid false positives", () => {
    const allow = ["it is a gift"];
    // "it" appears in many keywords; should not match
    expect(matchesBootleAllowlist("crypto memes", allow)).toBe(false);
  });

  it("rejects unrelated keywords", () => {
    expect(matchesBootleAllowlist("michael jackson", allowlist)).toBe(false);
    expect(matchesBootleAllowlist("crypto memes", allowlist)).toBe(false);
    expect(matchesBootleAllowlist("tomodachi life island layout", allowlist)).toBe(false);
  });
});
