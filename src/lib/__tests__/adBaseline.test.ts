import { describe, it, expect } from "vitest";
import {
  estimateBaseline,
  defaultBaselineWindow,
  type DailyAdRow,
  type ShopifySalesRow,
} from "../adBaseline";

const WINDOW = { start: "2026-01-01", end: "2026-01-31" };

function daily(overrides: Partial<DailyAdRow> & { date: string }): DailyAdRow {
  return {
    spend: 0,
    impressions: 0,
    clicks: 0,
    purchases: 0,
    ...overrides,
  };
}

function shopify(
  overrides: Partial<ShopifySalesRow> & { date: string },
): ShopifySalesRow {
  return {
    orders: 0,
    grossRevenue: 0,
    currency: "EUR",
    ...overrides,
  };
}

describe("pooled ratios (sum num / sum den), not mean-of-daily", () => {
  // Two days: a high-volume day and a tiny noisy day. Pooled CPC must be
  // volume-weighted, NOT the average of the two daily CPCs.
  const rows: DailyAdRow[] = [
    daily({ date: "2026-01-10", spend: 200, clicks: 500, impressions: 12000 }),
    daily({ date: "2026-01-11", spend: 5, clicks: 1, impressions: 100 }), // CPC 5.0 fluke
  ];

  it("pooled CPC = total spend / total clicks", () => {
    const b = estimateBaseline(rows, [], WINDOW);
    expect(b.cpc.value).toBeCloseTo(205 / 501, 9); // ≈ 0.409, not (0.4+5.0)/2
  });

  it("differs sharply from the naive mean of daily CPCs", () => {
    const b = estimateBaseline(rows, [], WINDOW);
    const naiveMean = (200 / 500 + 5 / 1) / 2; // 2.7
    expect(Math.abs((b.cpc.value as number) - naiveMean)).toBeGreaterThan(2);
  });

  it("pooled CTR = total clicks / total impressions", () => {
    const b = estimateBaseline(rows, [], WINDOW);
    expect(b.ctr.value).toBeCloseTo(501 / 12100, 9);
  });

  it("pooled CPM = total spend / total impressions * 1000", () => {
    const b = estimateBaseline(rows, [], WINDOW);
    expect(b.cpm.value).toBeCloseTo((205 / 12100) * 1000, 6);
  });
});

describe("minimum-volume guards", () => {
  it("CPC is undefined / confidence none below minClicks (30)", () => {
    const rows = [daily({ date: "2026-01-10", spend: 10, clicks: 20, impressions: 500 })];
    const b = estimateBaseline(rows, [], WINDOW);
    expect(b.cpc.value).toBeUndefined();
    expect(b.cpc.confidence).toBe("none");
  });

  it("CVR needs minClicksForCvr (200), far more than CPC", () => {
    // 100 clicks: enough for CPC ("ok" path) but not for CVR.
    const rows = [
      daily({ date: "2026-01-10", spend: 40, clicks: 100, impressions: 3000, purchases: 2 }),
    ];
    const b = estimateBaseline(rows, [], WINDOW);
    expect(b.cpc.value).toBeDefined();
    expect(b.clickCvr.value).toBeUndefined();
    expect(b.clickCvr.confidence).toBe("none");
  });

  it("CVR resolves once click volume clears the guard", () => {
    const rows = [
      daily({ date: "2026-01-10", spend: 100, clicks: 300, impressions: 8000, purchases: 6 }),
    ];
    const b = estimateBaseline(rows, [], WINDOW);
    expect(b.clickCvr.value).toBeCloseTo(6 / 300, 9);
  });

  it("flags 'low' within lowMultiple of the floor, 'ok' well above", () => {
    const low = estimateBaseline(
      [daily({ date: "2026-01-10", spend: 20, clicks: 40, impressions: 1200 })],
      [],
      WINDOW,
    );
    expect(low.cpc.confidence).toBe("low"); // 40 clicks, floor 30, < 60
    const ok = estimateBaseline(
      [daily({ date: "2026-01-10", spend: 100, clicks: 400, impressions: 12000 })],
      [],
      WINDOW,
    );
    expect(ok.cpc.confidence).toBe("ok"); // 400 >> 60
  });
});

describe("zero-purchase window: CVR is a real 0, capped to low confidence", () => {
  it("returns clickCvr 0 but 'low' confidence (0 purchases < the purchase floor)", () => {
    // 500 clicks clears the click denominator guard, but 0 purchases is below
    // minPurchasesForCvr (10), so confidence is capped to "low" and n = 0.
    const rows = [
      daily({ date: "2026-01-10", spend: 150, clicks: 500, impressions: 12000, purchases: 0 }),
    ];
    const b = estimateBaseline(rows, [], WINDOW);
    expect(b.clickCvr.value).toBe(0);
    expect(b.clickCvr.confidence).toBe("low");
    expect(b.clickCvr.n).toBe(0); // n now reports the binding purchase count
  });

  it("CVR reaches 'ok' only with enough purchases AND clicks", () => {
    const rows = [
      daily({ date: "2026-01-10", spend: 300, clicks: 600, impressions: 15000, purchases: 15 }),
    ];
    const b = estimateBaseline(rows, [], WINDOW);
    expect(b.clickCvr.value).toBeCloseTo(15 / 600, 9);
    expect(b.clickCvr.confidence).toBe("ok"); // 15 purchases >= floor of 10
  });
});

describe("ad-attributed funnel (same-source CVR + AOV)", () => {
  it("pools CVR and AOV from Ad Snapshots when provided", () => {
    const daily0 = [daily({ date: "2026-01-10", spend: 894, clicks: 2624, impressions: 55719 })];
    const ads = [
      { date: "2026-01-10", clicks: 2624, purchases: 5, purchaseValue: 249.06 },
    ];
    const b = estimateBaseline(daily0, [], WINDOW, ads);
    expect(b.clickCvr.value).toBeCloseTo(5 / 2624, 9);
    expect(b.aov.value).toBeCloseTo(249.06 / 5, 6); // €49.81 ad-attributed
    expect(b.counts.adPurchases).toBe(5);
    expect(b.counts.adClicks).toBe(2624);
  });

  it("caps CVR + ad-AOV to 'low' on a 5-purchase sample and exposes a Wilson interval", () => {
    const daily0 = [daily({ date: "2026-01-10", spend: 894, clicks: 2624, impressions: 55719 })];
    const ads = [{ date: "2026-01-10", clicks: 2624, purchases: 5, purchaseValue: 249.06 }];
    const b = estimateBaseline(daily0, [], WINDOW, ads);
    expect(b.clickCvr.confidence).toBe("low"); // 5 < minPurchasesForCvr
    expect(b.aov.confidence).toBe("low");
    expect(b.clickCvrInterval).toBeDefined();
    expect(b.clickCvrInterval!.low).toBeLessThan(b.clickCvr.value!);
    expect(b.clickCvrInterval!.high).toBeGreaterThan(b.clickCvr.value!);
  });

  it("keeps a separate whole-store shopifyAov for comparison", () => {
    const daily0 = [daily({ date: "2026-01-10", spend: 894, clicks: 2624, impressions: 55719 })];
    const ads = [{ date: "2026-01-10", clicks: 2624, purchases: 5, purchaseValue: 249.06 }];
    const shop = Array.from({ length: 12 }, (_, i) =>
      shopify({ date: `2026-01-${String(i + 10).padStart(2, "0")}`, orders: 1, grossRevenue: 65 }),
    );
    const b = estimateBaseline(daily0, shop, WINDOW, ads);
    expect(b.aov.value).toBeCloseTo(49.812, 2); // ad-attributed (funnel default)
    expect(b.shopifyAov.value).toBeCloseTo(65, 6); // whole-store (comparison)
  });
});

describe("all-zero-spend window", () => {
  it("every ad estimate is undefined / none", () => {
    const rows = [
      daily({ date: "2026-01-10" }),
      daily({ date: "2026-01-11" }),
    ];
    const b = estimateBaseline(rows, [], WINDOW);
    expect(b.cpc.value).toBeUndefined();
    expect(b.ctr.value).toBeUndefined();
    expect(b.clickCvr.value).toBeUndefined();
  });
});

describe("AOV from Shopify — gross, EUR-only", () => {
  it("AOV = sum(gross) / sum(orders) over EUR rows", () => {
    const rows = Array.from({ length: 12 }, (_, i) =>
      shopify({ date: `2026-01-${String(i + 1).padStart(2, "0")}`, orders: 1, grossRevenue: 40 + i }),
    );
    const b = estimateBaseline([], rows, WINDOW);
    const expectedAov =
      rows.reduce((s, r) => s + r.grossRevenue, 0) / rows.length;
    expect(b.aov.value).toBeCloseTo(expectedAov, 9);
  });

  it("uses GROSS even when net would be negative (discount day)", () => {
    // 11 clean rows + 1 with a heavy discount: gross stays positive.
    const rows = [
      ...Array.from({ length: 11 }, (_, i) =>
        shopify({ date: `2026-01-${String(i + 1).padStart(2, "0")}`, orders: 1, grossRevenue: 50 }),
      ),
      shopify({ date: "2026-01-20", orders: 1, grossRevenue: 0.73 }), // net was negative
    ];
    const b = estimateBaseline([], rows, WINDOW);
    expect(b.aov.value).toBeCloseTo((11 * 50 + 0.73) / 12, 6);
  });

  it("drops a negative-GROSS row as corrupt and counts it", () => {
    const rows = [
      ...Array.from({ length: 11 }, (_, i) =>
        shopify({ date: `2026-01-${String(i + 1).padStart(2, "0")}`, orders: 1, grossRevenue: 50 }),
      ),
      shopify({ date: "2026-01-20", orders: 1, grossRevenue: -10 }),
    ];
    const b = estimateBaseline([], rows, WINDOW);
    expect(b.flags.droppedNegativeGrossRows).toBe(1);
    expect(b.aov.value).toBeCloseTo((11 * 50) / 11, 6); // 50, corrupt row excluded
  });

  it("excludes GBP rows, flags mixedCurrency + count", () => {
    const rows = [
      ...Array.from({ length: 11 }, (_, i) =>
        shopify({ date: `2026-01-${String(i + 1).padStart(2, "0")}`, orders: 1, grossRevenue: 50 }),
      ),
      shopify({ date: "2026-01-20", orders: 1, grossRevenue: 80, currency: "GBP" }),
    ];
    const b = estimateBaseline([], rows, WINDOW);
    expect(b.flags.mixedCurrency).toBe(true);
    expect(b.flags.droppedCurrencyRows).toBe(1);
    expect(b.aov.value).toBeCloseTo(50, 6); // GBP not blended
  });

  it("AOV undefined below minOrders (10)", () => {
    const rows = [shopify({ date: "2026-01-10", orders: 3, grossRevenue: 150 })];
    const b = estimateBaseline([], rows, WINDOW);
    expect(b.aov.value).toBeUndefined();
    expect(b.aov.confidence).toBe("none");
  });
});

describe("window filtering and single-day", () => {
  it("ignores rows outside the window", () => {
    const rows = [
      daily({ date: "2025-12-31", spend: 999, clicks: 999, impressions: 999 }),
      daily({ date: "2026-01-10", spend: 100, clicks: 400, impressions: 12000 }),
    ];
    const b = estimateBaseline(rows, [], WINDOW);
    expect(b.cpc.value).toBeCloseTo(100 / 400, 9); // the out-of-window row excluded
    expect(b.window.days).toBe(1);
  });

  it("single-day window pools that day's ratios when above guards", () => {
    const rows = [daily({ date: "2026-01-10", spend: 100, clicks: 400, impressions: 12000 })];
    const b = estimateBaseline(rows, [], WINDOW);
    expect(b.cpc.value).toBeCloseTo(0.25, 9);
  });
});

describe("defaultBaselineWindow", () => {
  it("ignores zero-spend days and ends on the latest active day", () => {
    const rows = [
      daily({ date: "2025-12-01", spend: 50, clicks: 100 }),
      daily({ date: "2026-01-10", spend: 80, clicks: 200 }),
      daily({ date: "2026-02-01", spend: 0 }), // zero-spend tail excluded
    ];
    // 45-day lookback from 2026-01-10 reaches back past 2025-12-01 (40 days).
    expect(defaultBaselineWindow(rows)).toEqual({
      start: "2025-12-01",
      end: "2026-01-10",
    });
  });

  it("isolates the latest burst, dropping stale spend beyond the lookback", () => {
    const rows = [
      daily({ date: "2025-05-28", spend: 100, clicks: 300 }), // ~8 months stale
      daily({ date: "2026-01-10", spend: 80, clicks: 200 }),
      daily({ date: "2026-01-22", spend: 90, clicks: 250 }),
    ];
    // 45-day lookback from 2026-01-22 keeps Jan only; May is dropped.
    expect(defaultBaselineWindow(rows)).toEqual({
      start: "2026-01-10",
      end: "2026-01-22",
    });
  });

  it("respects a custom lookback length", () => {
    const rows = [
      daily({ date: "2026-01-01", spend: 10, clicks: 10 }),
      daily({ date: "2026-01-20", spend: 20, clicks: 20 }), // 19 days before latest
      daily({ date: "2026-01-22", spend: 30, clicks: 30 }),
    ];
    // 10-day lookback from 2026-01-22 keeps only days on/after 2026-01-12.
    expect(defaultBaselineWindow(rows, 10)).toEqual({
      start: "2026-01-20",
      end: "2026-01-22",
    });
  });

  it("falls back to an all-encompassing window when no day has spend", () => {
    const rows = [daily({ date: "2026-01-10", spend: 0 })];
    const w = defaultBaselineWindow(rows);
    expect(w.start).toBe("1970-01-01");
    expect(w.end).toBe("2999-12-31");
  });

  it("handles a single active day", () => {
    const rows = [daily({ date: "2026-01-10", spend: 50, clicks: 100 })];
    expect(defaultBaselineWindow(rows)).toEqual({
      start: "2026-01-10",
      end: "2026-01-10",
    });
  });
});

describe("data-integrity filters (validated against live data 2026-06-17)", () => {
  it("drops phantom conversions (purchase on zero clicks) and flags the count", () => {
    // Real case: 2026-01-25/26 each posted a purchase with 0 clicks / 0 spend.
    const daily0 = [daily({ date: "2026-01-10", spend: 894, clicks: 2624, impressions: 55719 })];
    const ads = [
      { date: "2026-01-10", clicks: 2624, purchases: 5, purchaseValue: 249.06 },
      { date: "2026-01-25", clicks: 0, purchases: 1, purchaseValue: 0 }, // phantom
      { date: "2026-01-26", clicks: 0, purchases: 1, purchaseValue: 0 }, // phantom
    ];
    const b = estimateBaseline(daily0, [], WINDOW, ads);
    expect(b.counts.adPurchases).toBe(5); // 7 raw → 5 after dropping phantoms
    expect(b.flags.droppedPhantomConversions).toBe(2);
    expect(b.clickCvr.value).toBeCloseTo(5 / 2624, 9);
  });

  it("computes ad-AOV from value-bearing purchases only (not zero-value rows)", () => {
    // One day, 6 purchases but only €249.06 of value across 5 of them; a 6th
    // purchase posted €0 value. AOV must be 249.06/5, not 249.06/6.
    const daily0 = [daily({ date: "2026-01-10", spend: 894, clicks: 2624, impressions: 55719 })];
    const ads = [
      { date: "2026-01-10", clicks: 2000, purchases: 5, purchaseValue: 249.06 },
      { date: "2026-01-11", clicks: 624, purchases: 1, purchaseValue: 0 }, // value-less
    ];
    const b = estimateBaseline(daily0, [], WINDOW, ads);
    expect(b.aov.value).toBeCloseTo(249.06 / 5, 6); // €49.81, not /6
  });

  it("excludes 100%-off comp orders (net <= 0 or discount >= gross) from store AOV", () => {
    const shop = [
      ...Array.from({ length: 10 }, (_, i) =>
        shopify({ date: `2026-01-${String(i + 10).padStart(2, "0")}`, orders: 1, grossRevenue: 60, netRevenue: 60, totalDiscounts: 0 }),
      ),
      shopify({ date: "2026-01-20", orders: 1, grossRevenue: 8, netRevenue: -100, totalDiscounts: 0 }), // net<=0 comp
      shopify({ date: "2026-01-21", orders: 1, grossRevenue: 50, netRevenue: 0, totalDiscounts: 50 }), // 100%-off
    ];
    const b = estimateBaseline([daily({ date: "2026-01-10" })], shop, WINDOW);
    expect(b.shopifyAov.value).toBeCloseTo(60, 6); // only the 10 clean €60 orders
    expect(b.flags.droppedCompRows).toBe(2);
  });

  it("reports the latest active spend date for the staleness banner", () => {
    const rows = [
      daily({ date: "2026-01-10", spend: 50, clicks: 100 }),
      daily({ date: "2026-01-22", spend: 80, clicks: 120 }),
      daily({ date: "2026-01-26", spend: 0, clicks: 0 }), // zero-spend, ignored
    ];
    const b = estimateBaseline(rows, [], WINDOW);
    expect(b.flags.latestSpendDate).toBe("2026-01-22");
  });
});

describe("fractional (modeled) conversions are preserved, not floored", () => {
  it("keeps fractional ad purchases in CVR and AOV", () => {
    // Meta modeled conversions are decimals. A floor() at ingestion would zero
    // 0.6 and truncate 2.7 → 2; the lib must carry the fraction through.
    const daily0 = [daily({ date: "2026-01-10", spend: 500, clicks: 2000, impressions: 50000 })];
    const ads = [{ date: "2026-01-10", clicks: 2000, purchases: 2.7, purchaseValue: 135 }];
    const b = estimateBaseline(daily0, [], WINDOW, ads);
    expect(b.counts.adPurchases).toBeCloseTo(2.7, 6); // not floored to 2
    expect(b.clickCvr.value).toBeCloseTo(2.7 / 2000, 9);
    expect(b.aov.value).toBeCloseTo(135 / 2.7, 6); // €50, denominator stays fractional
  });
});
