import { describe, it, expect } from "vitest";
import {
  formatGrowthDisplay,
  GROWTH_BREAKOUT_THRESHOLD,
} from "../PinterestInsights";

describe("formatGrowthDisplay", () => {
  it("labels a huge low-base value as 'breakout', not a fake-precise percentage", () => {
    expect(formatGrowthDisplay(10000)).toEqual({
      label: "breakout",
      kind: "breakout",
    });
    expect(formatGrowthDisplay(7500)).toEqual({
      label: "breakout",
      kind: "breakout",
    });
    // Exactly at the threshold counts as breakout.
    expect(formatGrowthDisplay(GROWTH_BREAKOUT_THRESHOLD).kind).toBe("breakout");
  });

  it("prints a normal signed percentage below the threshold", () => {
    expect(formatGrowthDisplay(200)).toEqual({ label: "+200%", kind: "up" });
    expect(formatGrowthDisplay(15)).toEqual({ label: "+15%", kind: "up" });
  });

  it("marks declines as down", () => {
    expect(formatGrowthDisplay(-20)).toEqual({ label: "-20%", kind: "down" });
  });

  it("treats zero and non-finite as a neutral 0%", () => {
    expect(formatGrowthDisplay(0)).toEqual({ label: "0%", kind: "zero" });
    expect(formatGrowthDisplay(NaN).kind).toBe("zero");
    expect(formatGrowthDisplay(Infinity).kind).toBe("zero");
  });
});
