/**
 * Unit tests for the account_daily_facts platform-completeness guard
 * (WEBDEV-228; WEBDEV-216 retired the Airtable fallback so an incomplete read
 * now throws instead of falling back). hasAllExpectedPlatforms must return true
 * only when EVERY expected platform is present, defending against a
 * Supabase-side write gap that would otherwise serve a platform's dropped KPIs.
 */

import { describe, it, expect } from "vitest";
import {
  hasAllExpectedPlatforms,
  EXPECTED_ACCOUNT_PLATFORMS,
} from "../sourceSwitch";

/** Minimal mapped-envelope row carrying just the Platform field the guard reads. */
function platformRow(platform: string) {
  return { fields: { Platform: platform } };
}

describe("hasAllExpectedPlatforms — account_daily_facts partial-platform guard", () => {
  it("EXPECTED_ACCOUNT_PLATFORMS is exactly the three account writers' platforms", () => {
    expect([...EXPECTED_ACCOUNT_PLATFORMS].sort()).toEqual([
      "facebook",
      "instagram",
      "pinterest",
    ]);
  });

  it("true when every expected platform is present (extra rows per platform are fine)", () => {
    const rows = [
      platformRow("instagram"),
      platformRow("instagram"),
      platformRow("facebook"),
      platformRow("pinterest"),
    ];
    expect(hasAllExpectedPlatforms(rows)).toBe(true);
  });

  it("FALSE when a writer's platform is missing (Pinterest gap) — caller refuses the partial read", () => {
    // Simulates the Pinterest Data Refresher failing to write while the Social
    // refresher (IG/FB) succeeded: rows.length > 0 but Pinterest absent.
    const rows = [platformRow("instagram"), platformRow("facebook")];
    expect(hasAllExpectedPlatforms(rows)).toBe(false);
  });

  it("FALSE on an empty result (so an empty Supabase read is refused by the caller)", () => {
    expect(hasAllExpectedPlatforms([])).toBe(false);
  });

  it("case-folds + trims the Platform value so a writer emitting 'Instagram'/' Pinterest ' does NOT reject a complete read forever", () => {
    const rows = [
      platformRow("Instagram"),
      platformRow("FACEBOOK"),
      platformRow("  pinterest  "),
    ];
    expect(hasAllExpectedPlatforms(rows)).toBe(true);
  });

  it("respects a custom expected list", () => {
    const rows = [platformRow("instagram"), platformRow("facebook")];
    expect(hasAllExpectedPlatforms(rows, ["instagram", "facebook"])).toBe(true);
    expect(hasAllExpectedPlatforms(rows, ["instagram", "tiktok"])).toBe(false);
  });
});
