import { describe as describeTest, it, expect } from "vitest";
import {
  describe,
  quantile,
  outlierIndices,
  pearson,
  pctChange,
  formatPct,
  trendVerdict,
} from "../stats";

describeTest("quantile", () => {
  it("returns NaN on empty", () => {
    expect(quantile([], 0.5)).toBeNaN();
  });
  it("returns the only value when length=1", () => {
    expect(quantile([42], 0.5)).toBe(42);
  });
  it("matches numpy linear interpolation", () => {
    // [1,2,3,4,5] -> q25 = 2, q50 = 3, q75 = 4
    expect(quantile([1, 2, 3, 4, 5], 0.25)).toBe(2);
    expect(quantile([1, 2, 3, 4, 5], 0.5)).toBe(3);
    expect(quantile([1, 2, 3, 4, 5], 0.75)).toBe(4);
  });
  it("interpolates between order statistics", () => {
    // [1,2,3,4] q50 -> pos=1.5 -> 2.5
    expect(quantile([1, 2, 3, 4], 0.5)).toBe(2.5);
  });
});

describeTest("describe", () => {
  it("returns undefined on empty input", () => {
    expect(describe([])).toBeUndefined();
  });
  it("filters NaN / null / undefined / Infinity", () => {
    const s = describe([1, 2, NaN, null, undefined, Infinity, 3]);
    expect(s?.n).toBe(3);
    expect(s?.mean).toBe(2);
  });
  it("computes population stdev (not sample)", () => {
    // [2,4,4,4,5,5,7,9] -> mean 5, pop variance 4, pop stdev 2
    const s = describe([2, 4, 4, 4, 5, 5, 7, 9]);
    expect(s?.stdev).toBeCloseTo(2);
  });
  it("computes iqr", () => {
    const s = describe([1, 2, 3, 4, 5]);
    expect(s?.iqr).toBe(2); // 4 - 2
  });
});

describeTest("outlierIndices", () => {
  it("returns empty for n<4", () => {
    expect(outlierIndices([1, 2, 3])).toEqual([]);
  });
  it("flags clear outliers via 1.5*IQR", () => {
    // 100 is far above [1,2,3,4,5,6,7,8] -> flagged
    const idx = outlierIndices([1, 2, 3, 4, 5, 6, 7, 8, 100]);
    expect(idx).toContain(8);
  });
  it("ignores tight clusters", () => {
    expect(outlierIndices([5, 5, 5, 5, 6, 6, 6, 6])).toEqual([]);
  });
});

describeTest("pearson", () => {
  it("returns 1 for perfect positive correlation", () => {
    expect(pearson([1, 2, 3, 4], [2, 4, 6, 8])).toBeCloseTo(1);
  });
  it("returns -1 for perfect negative correlation", () => {
    expect(pearson([1, 2, 3, 4], [4, 3, 2, 1])).toBeCloseTo(-1);
  });
  it("returns undefined when a series is constant (zero variance)", () => {
    expect(pearson([1, 2, 3], [5, 5, 5])).toBeUndefined();
  });
  it("returns undefined on mismatched lengths", () => {
    expect(pearson([1, 2], [1, 2, 3])).toBeUndefined();
  });
  it("pairwise-drops non-finite values", () => {
    // (1,1), (NaN,2 dropped), (3,3), (4,4) -> still strong positive
    const r = pearson([1, NaN, 3, 4], [1, 2, 3, 4]);
    expect(r).toBeGreaterThan(0.9);
  });
});

describeTest("pctChange", () => {
  it("returns undefined when from=0 (zero-baseline trap)", () => {
    expect(pctChange(0, 100)).toBeUndefined();
  });
  it("computes signed pct change", () => {
    expect(pctChange(100, 150)).toBe(50);
    expect(pctChange(100, 50)).toBe(-50);
  });
  it("uses absolute value of denominator", () => {
    expect(pctChange(-100, -50)).toBe(50);
  });
});

describeTest("formatPct", () => {
  it("renders — for undefined", () => {
    expect(formatPct(undefined)).toBe("—");
  });
  it("prefixes + on positives and zero", () => {
    expect(formatPct(12.34)).toBe("+12.3%");
    expect(formatPct(0)).toBe("+0.0%");
  });
  it("keeps native sign on negatives", () => {
    expect(formatPct(-5)).toBe("-5.0%");
  });
});

describeTest("trendVerdict", () => {
  it("flat for undefined", () => {
    expect(trendVerdict(undefined)).toBe("flat");
  });
  it("respects threshold", () => {
    expect(trendVerdict(4.9)).toBe("flat");
    expect(trendVerdict(5)).toBe("accelerating");
    expect(trendVerdict(-5)).toBe("decelerating");
  });
});
