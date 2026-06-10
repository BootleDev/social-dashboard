/**
 * Unit tests for the per-table kill switch (WEBDEV-207 cutover; hardened
 * version ported from ad-dashboard in WEBDEV-210). forcedToAirtable is the
 * ONLY manual rollback mechanism, so the match must survive the values a
 * human actually pastes into Vercel (trailing newline, stray spaces, odd
 * casing), and any unrecognized non-empty value must WARN so the typo is
 * visible in the Vercel logs instead of silently no-oping the rollback.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { forcedToAirtable } from "../sourceSwitch";

let warnSpy: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
});

afterEach(() => {
  warnSpy.mockRestore();
});

describe("forcedToAirtable — per-table kill switch", () => {
  it('exact "airtable" forces Airtable, no warning', () => {
    expect(forcedToAirtable("airtable", "DAILY_METRICS_SOURCE")).toBe(true);
    expect(warnSpy).not.toHaveBeenCalled();
  });

  it('tolerates a trailing newline: "airtable\\n" forces Airtable, no warning', () => {
    expect(forcedToAirtable("airtable\n", "DAILY_METRICS_SOURCE")).toBe(true);
    expect(warnSpy).not.toHaveBeenCalled();
  });

  it('tolerates whitespace + casing: "  Airtable " forces Airtable, no warning', () => {
    expect(forcedToAirtable("  Airtable ", "WEEKLY_SUMMARIES_SOURCE")).toBe(
      true,
    );
    expect(warnSpy).not.toHaveBeenCalled();
  });

  it("unset (undefined) stays on the Supabase-first path, no warning", () => {
    expect(forcedToAirtable(undefined, "SOCIAL_ALERTS_SOURCE")).toBe(false);
    expect(warnSpy).not.toHaveBeenCalled();
  });

  it("empty / whitespace-only values behave as unset, no warning", () => {
    expect(forcedToAirtable("", "DAILY_METRICS_SOURCE")).toBe(false);
    expect(forcedToAirtable("  \n", "DAILY_METRICS_SOURCE")).toBe(false);
    expect(warnSpy).not.toHaveBeenCalled();
  });

  it('an unrecognized value ("airtabel" typo) does NOT force Airtable and WARNS with the var name', () => {
    expect(forcedToAirtable("airtabel", "DAILY_METRICS_SOURCE")).toBe(false);
    expect(warnSpy).toHaveBeenCalledTimes(1);
    const message = String(warnSpy.mock.calls[0][0]);
    expect(message).toContain("DAILY_METRICS_SOURCE");
    expect(message).toContain("airtabel");
  });

  it("warns on EVERY call while misconfigured (no memo — stays visible in logs)", () => {
    forcedToAirtable("supabase", "SOCIAL_ALERTS_SOURCE");
    forcedToAirtable("supabase", "SOCIAL_ALERTS_SOURCE");
    expect(warnSpy).toHaveBeenCalledTimes(2);
  });
});
