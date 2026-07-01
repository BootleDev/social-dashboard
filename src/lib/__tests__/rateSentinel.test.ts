/**
 * Locks the runtime unit-scale sentinel (WEBDEV-210): percent-scale drift on
 * engagement_rate must THROW (so the getter's rejection propagates to the
 * caller — WEBDEV-216 retired the Airtable fallback), warnOn columns must only
 * console.warn, and count columns are never subject to either — they are simply
 * not listed.
 *
 * The fixtures use pg-shaped rows: numeric columns arrive as STRINGS from
 * node-pg (e.g. "0.0870"), so the sentinel must parse, not typeof-gate.
 */
import { describe, it, expect, vi, afterEach } from "vitest";
import { assertFractionScale } from "../rateSentinel";

// Mirrors the production policy for social.daily_account_metrics in
// supabase.ts (idCols = the composite key: one row per platform per day).
const DAILY_COLS = {
  throwOn: ["engagement_rate"],
  idCols: ["platform", "date"],
} as const;

/** A healthy fraction-scale row as pg returns it (numerics as strings). */
function healthyRow(overrides: Record<string, unknown> = {}) {
  return {
    date: "2026-06-01",
    platform: "Instagram",
    followers: 1240,
    engagement_rate: "0.0870",
    ...overrides,
  };
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("assertFractionScale — pass cases", () => {
  it("passes on healthy fraction-scale rows (pg numeric strings)", () => {
    expect(() =>
      assertFractionScale(
        "social.daily_account_metrics",
        [healthyRow(), healthyRow({ date: "2026-06-02", platform: "TikTok" })],
        DAILY_COLS,
      ),
    ).not.toThrow();
  });

  it("passes on an empty result set", () => {
    expect(() =>
      assertFractionScale("social.daily_account_metrics", [], DAILY_COLS),
    ).not.toThrow();
  });

  it("passes at exactly 1 (a true 100% rate is legitimate; the check is strictly > 1)", () => {
    expect(() =>
      assertFractionScale(
        "social.daily_account_metrics",
        [healthyRow({ engagement_rate: "1" })],
        DAILY_COLS,
      ),
    ).not.toThrow();
  });

  it("skips null / undefined / missing cells (Airtable-sparse parity)", () => {
    expect(() =>
      assertFractionScale(
        "social.daily_account_metrics",
        [healthyRow({ engagement_rate: null })],
        DAILY_COLS,
      ),
    ).not.toThrow();
  });

  it("skips non-numeric junk — scale is this sentinel's job, shape is the mappers'", () => {
    expect(() =>
      assertFractionScale(
        "social.daily_account_metrics",
        [healthyRow({ engagement_rate: "not-a-number" })],
        DAILY_COLS,
      ),
    ).not.toThrow();
  });

  it("ignores count columns > 1 that are not listed (followers 1240)", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    expect(() =>
      assertFractionScale(
        "social.daily_account_metrics",
        [healthyRow({ followers: 99999 })],
        DAILY_COLS,
      ),
    ).not.toThrow();
    expect(warn).not.toHaveBeenCalled();
  });
});

describe("assertFractionScale — throwOn (percent-scale drift)", () => {
  it("throws when engagement_rate is percent-scale, naming source, column, count and example row", () => {
    expect(() =>
      assertFractionScale(
        "social.daily_account_metrics",
        [healthyRow(), healthyRow({ date: "2026-06-02", engagement_rate: "8.70" })],
        DAILY_COLS,
      ),
    ).toThrow(
      // The example id is the platform|date composite (idCols). Single-line
      // error, so plain `.*` spans it.
      /social\.daily_account_metrics.*engagement_rate outside \[0, 1\] in 1\/2 rows.*Instagram\|2026-06-02.*"8\.70".*FRACTIONS/,
    );
  });

  it("throws on a plain-number percent value too (not just pg strings)", () => {
    expect(() =>
      assertFractionScale(
        "social.daily_account_metrics",
        [healthyRow({ engagement_rate: 8.7 })],
        DAILY_COLS,
      ),
    ).toThrow(/engagement_rate outside \[0, 1\]/);
  });

  it("throws on a NEGATIVE engagement_rate — a rate outside [0, 1] is corrupt in either direction", () => {
    expect(() =>
      assertFractionScale(
        "social.daily_account_metrics",
        [healthyRow({ engagement_rate: "-0.08" })],
        DAILY_COLS,
      ),
    ).toThrow(/engagement_rate outside \[0, 1\] in 1\/1 rows/);
  });

  it("shows '?' for a missing idCols part and falls back to the row index only when ALL parts are absent", () => {
    expect(() =>
      assertFractionScale(
        "social.daily_account_metrics",
        [healthyRow({ date: null, engagement_rate: "8.70" })],
        DAILY_COLS,
      ),
    ).toThrow(/Instagram\|\?/);
    expect(() =>
      assertFractionScale(
        "social.daily_account_metrics",
        [healthyRow({ platform: null, date: null, engagement_rate: "8.70" })],
        DAILY_COLS,
      ),
    ).toThrow(/row 0/);
  });
});

describe("assertFractionScale — warnOn (tolerated overshoot)", () => {
  // The production call registers NO warnOn columns (engagement_rate is the
  // only rate in daily_account_metrics); this spec exercises the generic
  // warn path with a deliberately fictitious column so the ported module
  // stays behavior-identical to ad-dashboard (where cvr/hook/hold use it).
  it("console.warns without throwing for a warnOn column", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    expect(() =>
      assertFractionScale(
        "social.daily_account_metrics",
        [healthyRow({ some_rate: "1.23" })],
        {
          throwOn: ["engagement_rate"],
          warnOn: ["some_rate"],
          idCols: ["platform", "date"],
        },
      ),
    ).not.toThrow();
    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn.mock.calls[0][0]).toMatch(/some_rate outside \[0, 1\] in 1\/1 rows/);
  });
});
