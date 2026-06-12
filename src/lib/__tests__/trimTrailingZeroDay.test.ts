import { describe, it, expect } from "vitest";
import { trimTrailingZeroDay } from "../utils";

describe("trimTrailingZeroDay", () => {
  it("trims the last date when all series are zero on it", () => {
    const dates = ["2026-05-24", "2026-05-25", "2026-05-26"];
    const a = [10, 11, 0];
    const b = [5, 5, 0];
    expect(trimTrailingZeroDay(dates, [a, b])).toEqual(["2026-05-24", "2026-05-25"]);
  });

  it("trims when trailing value is null on every series", () => {
    const dates = ["2026-05-24", "2026-05-25", "2026-05-26"];
    const a = [10, 11, null];
    const b = [5, 5, null];
    expect(trimTrailingZeroDay(dates, [a, b])).toEqual(["2026-05-24", "2026-05-25"]);
  });

  it("keeps the last date when at least one series has data", () => {
    const dates = ["2026-05-24", "2026-05-25", "2026-05-26"];
    const a = [10, 11, 0];
    const b = [5, 5, 12]; // b has data on the last day
    expect(trimTrailingZeroDay(dates, [a, b])).toEqual(dates);
  });

  it("handles empty input", () => {
    expect(trimTrailingZeroDay([], [])).toEqual([]);
  });

  it("only trims one day at a time", () => {
    // Even if multiple trailing days are zero, only the very last one is
    // trimmed — earlier zeros might be real "no posts" days.
    const dates = ["2026-05-24", "2026-05-25", "2026-05-26"];
    const a = [10, 0, 0];
    const b = [5, 0, 0];
    expect(trimTrailingZeroDay(dates, [a, b])).toEqual([
      "2026-05-24",
      "2026-05-25",
    ]);
  });
});
