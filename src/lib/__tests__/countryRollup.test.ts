import { describe, it, expect } from "vitest";
import { rollupCountries } from "../countryRollup";

/** Build a descending list of {bucket, value} country rows. */
function rows(...values: number[]) {
  return values.map((v, i) => ({ bucket: `C${i + 1}`, value: v }));
}

describe("rollupCountries", () => {
  it("returns all rows and no 'other' bucket when count is at or below the cap", () => {
    const input = rows(100, 50, 25);
    const result = rollupCountries(input, 10);
    expect(result.shown).toHaveLength(3);
    expect(result.other).toBeNull();
  });

  it("caps the shown list at topN and rolls the long tail into 'other'", () => {
    // 12 countries, cap 10 → 10 shown + 2 rolled into "other".
    const input = rows(120, 110, 100, 90, 80, 70, 60, 50, 40, 30, 20, 10);
    const result = rollupCountries(input, 10);
    expect(result.shown).toHaveLength(10);
    expect(result.shown[0].bucket).toBe("C1");
    expect(result.shown[9].bucket).toBe("C10");
    expect(result.other).not.toBeNull();
    expect(result.other!.countryCount).toBe(2);
    expect(result.other!.value).toBe(20 + 10);
  });

  it("preserves descending order in the shown list (sorts defensively)", () => {
    const input = [
      { bucket: "LOW", value: 5 },
      { bucket: "HIGH", value: 500 },
      { bucket: "MID", value: 50 },
      { bucket: "TINY", value: 1 },
    ];
    // cap 2 → tail is MID-rank-3 and below (MID, then LOW, TINY by value).
    const result = rollupCountries(input, 2);
    expect(result.shown.map((r) => r.bucket)).toEqual(["HIGH", "MID"]);
    expect(result.other!.countryCount).toBe(2);
    expect(result.other!.value).toBe(5 + 1);
  });

  it("does not create an 'other' bucket for exactly one country over the cap of 1", () => {
    // Edge: a single tail country would render as its own row, not 'Other (1)',
    // which is misleading. Fold only when ≥2 would be hidden.
    const input = rows(100, 50);
    const result = rollupCountries(input, 1);
    // 2 countries, cap 1, only 1 in the tail → show it rather than hide one as "other".
    expect(result.shown).toHaveLength(2);
    expect(result.other).toBeNull();
  });

  it("folds the tail when 2+ countries are below the cap", () => {
    const input = rows(100, 50, 25);
    const result = rollupCountries(input, 1);
    expect(result.shown).toHaveLength(1);
    expect(result.other!.countryCount).toBe(2);
    expect(result.other!.value).toBe(75);
  });

  it("handles an empty list", () => {
    const result = rollupCountries([], 10);
    expect(result.shown).toEqual([]);
    expect(result.other).toBeNull();
  });
});
