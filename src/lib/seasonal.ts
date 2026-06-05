/**
 * Seasonal Opportunities — domain model + peak-rule parser.
 *
 * Each row in the Airtable table is a recurring annual moment. The Peak Rule
 * field is a small DSL we parse into a concrete Date for the current or next
 * year. Used by the Planning tab "Upcoming Windows" panel and by the Pinterest
 * Trends Bootle-relevance filter (which derives an allowlist from all
 * Trend Keywords across all rows + a small content-pillar fallback list).
 */

import { num, str } from "./utils";
import type { AirtableRecord } from "./utils";

export type SeasonalMarket = "UK" | "DE" | "US" | "Global";

export type SeasonalCategory =
  | "Holiday-gifting"
  | "Wellness-reset"
  | "Seasonal-aesthetic"
  | "Retail-moment"
  | "Cultural-spike";

export interface SeasonalOpportunity {
  id: string;
  name: string;
  markets: SeasonalMarket[];
  category: SeasonalCategory | "";
  peakRule: string;
  windowEndDays: number;
  bootleAngle: string;
  trendKeywords: string[];
  notes: string;
}

export function toSeasonalOpportunity(r: AirtableRecord): SeasonalOpportunity {
  const trendKeywordsRaw = str(r.fields["Trend Keywords"]);
  const markets = (r.fields["Markets"] as string[] | undefined) ?? [];
  return {
    id: r.id,
    name: str(r.fields["Name"]),
    markets: markets as SeasonalMarket[],
    category: (str(r.fields["Category"]) as SeasonalCategory) || "",
    peakRule: str(r.fields["Peak Rule"]),
    windowEndDays: num(r.fields["Window End Days"]),
    bootleAngle: str(r.fields["Bootle Angle"]),
    trendKeywords: trendKeywordsRaw
      .split(",")
      .map((k) => k.trim().toLowerCase())
      .filter((k) => k.length > 0),
    notes: str(r.fields["Notes"]),
  };
}

// ---------- Peak rule parsing ----------

// Days are 0=Sun..6=Sat for compatibility with Date.getDay().
const DAY_MAP: Record<string, number> = {
  sun: 0,
  mon: 1,
  tue: 2,
  wed: 3,
  thu: 4,
  fri: 5,
  sat: 6,
};

const MONTH_MAP: Record<string, number> = {
  jan: 0,
  feb: 1,
  mar: 2,
  apr: 3,
  may: 4,
  june: 5,
  jul: 6,
  aug: 7,
  sep: 8,
  oct: 9,
  nov: 10,
  dec: 11,
};

const ORDINAL_MAP: Record<string, number> = {
  "1st": 1,
  "2nd": 2,
  "3rd": 3,
  "4th": 4,
  "5th": 5,
};

/**
 * Computus — Anonymous Gregorian algorithm. Returns the date of Easter Sunday
 * for the given year. Standard implementation; verified against known dates
 * (2024 = Mar 31, 2025 = Apr 20, 2026 = Apr 5, 2027 = Mar 28).
 */
function computeEaster(year: number): Date {
  const a = year % 19;
  const b = Math.floor(year / 100);
  const c = year % 100;
  const d = Math.floor(b / 4);
  const e = b % 4;
  const f = Math.floor((b + 8) / 25);
  const g = Math.floor((b - f + 1) / 3);
  const h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4);
  const k = c % 4;
  const l = (32 + 2 * e + 2 * i - h - k) % 7;
  const m = Math.floor((a + 11 * h + 22 * l) / 451);
  const month = Math.floor((h + l - 7 * m + 114) / 31) - 1;
  const day = ((h + l - 7 * m + 114) % 31) + 1;
  return new Date(Date.UTC(year, month, day));
}

/**
 * Lunar New Year lookup table (Gregorian dates). Source: Wikipedia / Hong Kong
 * Observatory. Add 5 years at a time as we approach the edge.
 */
const LUNAR_NEW_YEAR: Record<number, string> = {
  2026: "02-17",
  2027: "02-06",
  2028: "01-26",
  2029: "02-13",
  2030: "02-03",
  2031: "01-23",
  2032: "02-11",
  2033: "01-31",
  2034: "02-19",
  2035: "02-08",
};

/**
 * Diwali (Lakshmi Puja) lookup table. The major Diwali day; festival spans
 * 5 days. Source: drikpanchang.com / various.
 */
const DIWALI: Record<number, string> = {
  2026: "11-08",
  2027: "10-29",
  2028: "11-17",
  2029: "11-05",
  2030: "10-26",
  2031: "11-14",
  2032: "11-02",
  2033: "10-22",
  2034: "11-10",
  2035: "10-30",
};

/**
 * Parse a Peak Rule string against a reference year. Returns null for any
 * unparseable input (calling code should surface a warning, not crash).
 *
 * Supported:
 *   "MM-DD"                       fixed Gregorian date
 *   "{ordinal}-{day}-{month}"     e.g. 2nd-sun-may, 3rd-sun-june
 *   "last-{day}-{month}"          e.g. last-fri-nov, last-sun-june
 *   "easter"                      computed
 *   "easter-{N}d" / "easter+{N}d" easter +/- N days
 *   "summer-solstice"             approx 06-21
 *   "autumn-equinox"              approx 09-22
 *   "lunar-new-year"              table lookup
 *   "diwali"                      table lookup
 */
export function parsePeakRule(rule: string, year: number): Date | null {
  const r = rule.trim().toLowerCase();
  if (!r) return null;

  // MM-DD
  const fixedMatch = /^(\d{2})-(\d{2})$/.exec(r);
  if (fixedMatch) {
    const month = parseInt(fixedMatch[1], 10) - 1;
    const day = parseInt(fixedMatch[2], 10);
    if (month < 0 || month > 11 || day < 1 || day > 31) return null;
    return new Date(Date.UTC(year, month, day));
  }

  // {ordinal}-{day}-{month}
  const ordMatch = /^(1st|2nd|3rd|4th|5th)-([a-z]{3})-([a-z]+)$/.exec(r);
  if (ordMatch) {
    const n = ORDINAL_MAP[ordMatch[1]];
    const dow = DAY_MAP[ordMatch[2]];
    const month = MONTH_MAP[ordMatch[3]];
    if (n === undefined || dow === undefined || month === undefined) return null;
    return nthDayOfMonth(year, month, dow, n);
  }

  // last-{day}-{month}
  const lastMatch = /^last-([a-z]{3})-([a-z]+)$/.exec(r);
  if (lastMatch) {
    const dow = DAY_MAP[lastMatch[1]];
    const month = MONTH_MAP[lastMatch[2]];
    if (dow === undefined || month === undefined) return null;
    return lastDayOfMonth(year, month, dow);
  }

  // easter family
  if (r === "easter") return computeEaster(year);
  const easterOffset = /^easter([+-])(\d+)d$/.exec(r);
  if (easterOffset) {
    const sign = easterOffset[1] === "+" ? 1 : -1;
    const offset = parseInt(easterOffset[2], 10) * sign;
    const easter = computeEaster(year);
    return new Date(easter.getTime() + offset * 86400 * 1000);
  }

  if (r === "summer-solstice") return new Date(Date.UTC(year, 5, 21));
  if (r === "autumn-equinox") return new Date(Date.UTC(year, 8, 22));

  if (r === "lunar-new-year") {
    const fixed = LUNAR_NEW_YEAR[year];
    return fixed ? parsePeakRule(fixed, year) : null;
  }
  if (r === "diwali") {
    const fixed = DIWALI[year];
    return fixed ? parsePeakRule(fixed, year) : null;
  }

  return null;
}

function nthDayOfMonth(
  year: number,
  month: number,
  targetDow: number,
  n: number,
): Date {
  const first = new Date(Date.UTC(year, month, 1));
  const firstDow = first.getUTCDay();
  const offset = (targetDow - firstDow + 7) % 7;
  const day = 1 + offset + (n - 1) * 7;
  return new Date(Date.UTC(year, month, day));
}

function lastDayOfMonth(year: number, month: number, targetDow: number): Date {
  // Last day of the month
  const last = new Date(Date.UTC(year, month + 1, 0));
  const lastDow = last.getUTCDay();
  const offset = (lastDow - targetDow + 7) % 7;
  return new Date(Date.UTC(year, month, last.getUTCDate() - offset));
}

// ---------- Upcoming-window logic ----------

export interface UpcomingWindow {
  opportunity: SeasonalOpportunity;
  peak: Date;
  daysUntilPeak: number;
  /** True once we're inside the lead-time window OR past peak but inside the tail. */
  inWindow: boolean;
  /** True once peak has passed but we're still within Window End Days. */
  postPeak: boolean;
}

/**
 * Build the list of opportunities whose peak (current year or next) falls
 * within `horizonDays` of today, ordered nearest-first. Computes window status
 * relative to the uniform 4-week lead time.
 */
export function upcomingWindows(
  opportunities: SeasonalOpportunity[],
  today: Date = new Date(),
  horizonDays = 90,
  leadWeeks = 4,
): UpcomingWindow[] {
  const result: UpcomingWindow[] = [];
  const leadMs = leadWeeks * 7 * 86400 * 1000;
  const horizonMs = horizonDays * 86400 * 1000;
  const todayUtc = Date.UTC(
    today.getUTCFullYear(),
    today.getUTCMonth(),
    today.getUTCDate(),
  );

  for (const opp of opportunities) {
    const peak = nextPeak(opp.peakRule, new Date(todayUtc), opp.windowEndDays);
    if (!peak) continue;

    const diffMs = peak.getTime() - todayUtc;
    const windowEnd = peak.getTime() + opp.windowEndDays * 86400 * 1000;

    // Past peak but still in the post-window tail
    if (diffMs < 0 && windowEnd >= todayUtc) {
      result.push({
        opportunity: opp,
        peak,
        daysUntilPeak: Math.floor(diffMs / 86400 / 1000),
        inWindow: true,
        postPeak: true,
      });
      continue;
    }

    if (diffMs < 0 || diffMs > horizonMs) continue;

    result.push({
      opportunity: opp,
      peak,
      daysUntilPeak: Math.floor(diffMs / 86400 / 1000),
      inWindow: diffMs <= leadMs,
      postPeak: false,
    });
  }

  result.sort((a, b) => a.peak.getTime() - b.peak.getTime());
  return result;
}

/**
 * Compute the next peak date for a rule relative to today. Prefers the
 * current year's peak if it hasn't passed (or is still within its tail);
 * otherwise rolls forward to next year.
 */
function nextPeak(
  rule: string,
  today: Date,
  windowEndDays: number,
): Date | null {
  const year = today.getUTCFullYear();
  const thisYearPeak = parsePeakRule(rule, year);
  if (thisYearPeak) {
    const tailEndMs =
      thisYearPeak.getTime() + windowEndDays * 86400 * 1000;
    if (tailEndMs >= today.getTime()) return thisYearPeak;
  }
  return parsePeakRule(rule, year + 1);
}

// ---------- Bootle-relevance keyword allowlist ----------

/**
 * Baseline content pillars used as a fallback keyword set when the seasonal
 * table is empty or to broaden matching beyond seasonal moments alone.
 * Lowercase substrings; matching is case-insensitive substring against the
 * Pinterest trend keyword.
 */
export const CONTENT_PILLAR_KEYWORDS: readonly string[] = [
  // Direct drinkware / hydration
  "water bottle",
  "hydration",
  "drinkware",
  "drink",
  "drinks",
  "tumbler",
  "thermos",
  // Materials / sustainability
  "sustainable",
  "plastic free",
  "plastic-free",
  "eco",
  "stainless steel",
  "zero waste",
  // Wellness adjacencies
  "wellness",
  "tea",
  "infused water",
  "matcha",
  "smoothie",
  "self care",
  // Aesthetic adjacencies (high-volume Pinterest categories drinkware shows up in)
  "aesthetic",
  "essentials",
  "minimalist",
  "lifestyle",
  "outfit",
  "decor",
  "interior",
  "kitchen",
  "desk setup",
  "edc",
  "cozy",
  "cosy",
  // Gifting adjacencies
  "gift guide",
  "gifts for",
  "stocking stuffer",
  "secret santa",
  // Long-tail adjacencies surfaced by user keyword review (May 2026)
  "underconsumption",
  "buy it for life",
  "bifl",
  "recipe",
  "diy",
  "dorm",
  "brunch",
  "party",
  "hosting",
];

/**
 * Build the Bootle-relevant keyword allowlist by unioning the trend keywords
 * across all Seasonal Opportunities with the content-pillar baseline. All
 * lowercased; matching is substring on the trending keyword.
 */
export function buildBootleKeywordAllowlist(
  opportunities: SeasonalOpportunity[],
): string[] {
  const set = new Set<string>(CONTENT_PILLAR_KEYWORDS);
  for (const opp of opportunities) {
    for (const kw of opp.trendKeywords) set.add(kw);
  }
  return Array.from(set);
}

/**
 * Generic aesthetic / lifestyle terms that drinkware merely co-occurs with on
 * Pinterest. They are kept in the allowlist because "water bottle aesthetic" or
 * "desk setup" ARE relevant — but on their OWN they are far too broad to anchor
 * relevance: "harry styles concert outfit" or "michael jackson aesthetic" would
 * sail through on a single shared token. So a match on one of these never, by
 * itself, makes a keyword Bootle-relevant; a strong drinkware/wellness/gifting
 * signal must also be present. Matched as whole tokens, lowercase.
 */
const GENERIC_AESTHETIC_TERMS: ReadonlySet<string> = new Set([
  "aesthetic",
  "essentials",
  "minimalist",
  "lifestyle",
  "outfit",
  "outfits",
  "decor",
  "interior",
  "kitchen",
  "cozy",
  "cosy",
  "party",
  "diy",
  "dorm",
  "brunch",
  "hosting",
  "recipe",
  "recipes",
  "ideas",
  "inspo",
  "summer",
  "winter",
  "spring",
  "autumn",
  "fall",
]);

/**
 * Core relevance tokens — words that, on their OWN, genuinely signal a
 * Bootle-relevant keyword (drinkware, hydration, wellness, gifting). A single
 * shared token from THIS set qualifies a keyword; a shared word that is NOT in
 * this set (an event/context word like "festival", "black", "summer", or a
 * generic aesthetic term) does not. This is the inverse, stricter complement to
 * the substring rule below and is what keeps "festival nails" / "black noir" /
 * "summer outfits for men" out while admitting "wedding gift" or "matcha".
 */
const CORE_RELEVANCE_TOKENS: ReadonlySet<string> = new Set([
  // drinkware / hydration
  "bottle",
  "bottles",
  "water",
  "hydration",
  "hydrate",
  "drinkware",
  "drink",
  "drinks",
  "tumbler",
  "thermos",
  "flask",
  // wellness adjacencies
  "wellness",
  "tea",
  "matcha",
  "smoothie",
  "infused",
  // materials / sustainability
  "sustainable",
  "reusable",
  "eco",
  "stainless",
  // gifting (the noun that makes a seasonal moment a Bootle moment)
  "gift",
  "gifts",
  "gifting",
  "geschenk",
  // seasonal moments whose token is itself specific enough to anchor
  "wedding",
  "bridesmaid",
  "groomsmen",
  "graduation",
  "grad",
  "christmas",
  "weihnachtsgeschenk",
]);

/**
 * Is this token a meaningful (>= 3 char) word that isn't a generic aesthetic
 * filler? Used to decide whether a multi-word allowlist entry is specific
 * enough to be matched as a phrase substring.
 */
function isContentfulToken(t: string): boolean {
  return t.length >= 3 && !GENERIC_AESTHETIC_TERMS.has(t);
}

/**
 * True if `trendKeyword` is Bootle-relevant against the allowlist. A keyword
 * qualifies when EITHER:
 *
 *   1. Core-token overlap — it shares a word with the core relevance lexicon
 *      (CORE_RELEVANCE_TOKENS): "wedding", "gift", "hydration", "tea", … A
 *      generic or event-context word ("outfit", "festival", "summer", "black")
 *      is NOT in that set, so sharing only one of those never qualifies.
 *   2. Specific-phrase substring — a multi-word allowlist entry that carries at
 *      least one contentful (non-generic) token appears as a substring of the
 *      keyword (e.g. allowlist "black friday gift" inside "black friday gift
 *      guide"). The whole phrase must be present, so a lone shared word can't
 *      sneak through.
 *
 * This deliberately replaces the old "any shared >=3-char token" rule, which
 * let pop-culture and nail-art noise through on a single generic token. Single
 * generic-only allowlist entries (e.g. just "outfit") never match anything.
 * Whitespace, hyphens and apostrophes are word boundaries.
 */
export function matchesBootleAllowlist(
  trendKeyword: string,
  allowlist: string[],
): boolean {
  const k = trendKeyword.toLowerCase();
  const kTokens = tokenize(k);

  // Rule 1: the keyword itself carries a core relevance token.
  if (kTokens.some((t) => CORE_RELEVANCE_TOKENS.has(t))) return true;

  // Rule 2: a specific multi-word allowlist phrase appears in the keyword.
  for (const allowed of allowlist) {
    const a = allowed.toLowerCase();
    const aTokens = tokenize(a);
    if (aTokens.length < 2) continue; // single words handled by rule 1
    if (!aTokens.some(isContentfulToken)) continue; // all-generic phrase, skip
    if (k.includes(a)) return true;
  }
  return false;
}

/** Tokenize on whitespace, hyphens, apostrophes. Lowercase. Drops empty tokens. */
function tokenize(s: string): string[] {
  return s
    .toLowerCase()
    .split(/[\s\-'']+/)
    .filter((t) => t.length > 0);
}
