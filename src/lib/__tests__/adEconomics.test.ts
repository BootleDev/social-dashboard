import { describe, it, expect } from "vitest";
import {
  ratio,
  runCpc,
  runCpm,
  runCps,
  runProjection,
  effectiveCpc,
  breakEvenClickCvr,
  breakEvenCpa,
  netAov,
  impliedFromCps,
} from "../adEconomics";
import type { Scenario } from "../adScenario";

function cpc(overrides: Partial<Scenario> = {}): Scenario {
  return {
    model: "cpc",
    budget: 500,
    spend: 500,
    cpc: 0.4,
    aov: 45,
    grossMargin: 0.65,
    ltvMultiplier: 1,
    clickCvr: 0.015,
    ...overrides,
  };
}

function cpm(overrides: Partial<Scenario> = {}): Scenario {
  return {
    model: "cpm",
    budget: 500,
    spend: 500,
    cpm: 12,
    ctr: 0.039,
    aov: 45,
    grossMargin: 0.65,
    ltvMultiplier: 1,
    clickCvr: 0.015,
    ...overrides,
  };
}

describe("ratio", () => {
  it("divides for a positive denominator", () => {
    expect(ratio(10, 4)).toBe(2.5);
  });
  it("returns undefined (not Infinity) for a zero denominator", () => {
    expect(ratio(10, 0)).toBeUndefined();
  });
  it("returns undefined for a negative denominator", () => {
    expect(ratio(10, -2)).toBeUndefined();
  });
  it("returns undefined for non-finite operands", () => {
    expect(ratio(NaN, 4)).toBeUndefined();
    expect(ratio(10, Infinity)).toBeUndefined();
  });
});

describe("runCpc — the headline 'sales from spend' hand calc", () => {
  // €500 / €0.40 = 1250 clicks; click grain so sessions = clicks;
  // 1250 * 0.015 = 18.75 conversions; * €45 = €843.75 revenue.
  const p = runCpc(cpc());

  it("computes clicks = budget / cpc", () => {
    expect(p.clicks).toBeCloseTo(1250, 6);
  });
  it("sessions equal clicks under click grain (bounce defaulted to 0)", () => {
    expect(p.sessions).toBeCloseTo(1250, 6);
  });
  it("conversions = clicks * clickCvr, kept fractional", () => {
    expect(p.conversions).toBeCloseTo(18.75, 6);
  });
  it("revenue = conversions * aov", () => {
    expect(p.revenue).toBeCloseTo(843.75, 6);
  });
  it("cpa = spend / conversions", () => {
    expect(p.cpa).toBeCloseTo(500 / 18.75, 6); // ≈ 26.67
  });
  it("roas = revenue / spend", () => {
    expect(p.roas).toBeCloseTo(843.75 / 500, 6); // 1.6875
  });
  it("leaves impressions undefined (no impression count when buying clicks)", () => {
    expect(p.impressions).toBeUndefined();
  });
});

describe("runCpm", () => {
  // €500 / €12 * 1000 = 41,666.67 impressions; * 0.039 = 1625 clicks;
  // * 0.015 = 24.375 conversions; * €45 = €1096.875 revenue.
  const p = runCpm(cpm());

  it("impressions = budget / cpm * 1000", () => {
    expect(p.impressions).toBeCloseTo((500 / 12) * 1000, 4);
  });
  it("clicks = impressions * ctr", () => {
    expect(p.clicks).toBeCloseTo((500 / 12) * 1000 * 0.039, 4);
  });
  it("conversions flow through the shared tail", () => {
    expect(p.conversions).toBeCloseTo((500 / 12) * 1000 * 0.039 * 0.015, 4);
  });
});

describe("CPC and CPM share the same downstream from equal clicks", () => {
  it("matches conversions/revenue when clicks are made equal", () => {
    // Force CPM to yield exactly 1250 clicks: impressions*ctr = 1250.
    // impressions = budget/cpm*1000. Pick cpm so impressions*0.039 = 1250.
    // impressions needed = 1250/0.039 = 32051.28 → budget/cpm*1000 = 32051.28
    // with budget 500 → cpm = 500*1000/32051.28 = 15.6.
    const cpmScenario = cpm({ cpm: (500 * 1000) / (1250 / 0.039), ctr: 0.039 });
    const a = runCpc(cpc());
    const b = runCpm(cpmScenario);
    expect(b.clicks).toBeCloseTo(1250, 4);
    expect(b.conversions).toBeCloseTo(a.conversions as number, 4);
    expect(b.revenue).toBeCloseTo(a.revenue as number, 4);
  });
});

describe("session grain applies bounce exactly once", () => {
  it("sessions = clicks * (1 - bounceRate); conversions use sessionCvr", () => {
    const s = cpc({ clickCvr: undefined, bounceRate: 0.4, sessionCvr: 0.025 });
    const p = runCpc(s);
    expect(p.clicks).toBeCloseTo(1250, 6);
    expect(p.sessions).toBeCloseTo(1250 * 0.6, 6); // 750
    expect(p.conversions).toBeCloseTo(750 * 0.025, 6); // 18.75
  });

  it("click grain equals session grain when clickCvr = (1-bounce)*sessionCvr", () => {
    const clickP = runCpc(cpc({ clickCvr: 0.6 * 0.025 })); // 0.015
    const sessP = runCpc(
      cpc({ clickCvr: undefined, bounceRate: 0.4, sessionCvr: 0.025 }),
    );
    expect(clickP.conversions).toBeCloseTo(sessP.conversions as number, 9);
  });
});

describe("edge cases — undefined, never Infinity/NaN", () => {
  it("zero purchases → CVR 0 → conversions 0 → CPA undefined, ROAS 0", () => {
    const p = runCpc(cpc({ clickCvr: 0 }));
    expect(p.conversions).toBe(0);
    expect(p.cpa).toBeUndefined();
    expect(p.revenue).toBe(0);
    expect(p.roas).toBe(0);
  });

  it("budget = 0 → zero chain, CPA & ROAS undefined", () => {
    const p = runCpc(cpc({ budget: 0, spend: 0 }));
    expect(p.clicks).toBe(0);
    expect(p.conversions).toBe(0);
    expect(p.cpa).toBeUndefined();
    expect(p.roas).toBeUndefined();
  });

  it("cpc = 0 → whole chain undefined", () => {
    const p = runCpc(cpc({ cpc: 0 }));
    expect(p.clicks).toBeUndefined();
    expect(p.conversions).toBeUndefined();
    expect(p.cpa).toBeUndefined();
  });

  it("cpm = 0 → whole chain undefined", () => {
    const p = runCpm(cpm({ cpm: 0 }));
    expect(p.impressions).toBeUndefined();
    expect(p.clicks).toBeUndefined();
  });

  it("bounceRate = 1.0 → sessions 0 → conversions 0 → CPA undefined", () => {
    const p = runCpc(cpc({ clickCvr: undefined, bounceRate: 1, sessionCvr: 0.03 }));
    expect(p.sessions).toBe(0);
    expect(p.conversions).toBe(0);
    expect(p.cpa).toBeUndefined();
  });
});

describe("break-even helpers", () => {
  it("effectiveCpc returns the cpc input for a CPC model", () => {
    expect(effectiveCpc(cpc({ cpc: 0.4 }))).toBe(0.4);
  });

  it("effectiveCpc for CPM = cpm / (ctr * 1000)", () => {
    expect(effectiveCpc(cpm({ cpm: 12, ctr: 0.039 }))).toBeCloseTo(
      12 / (0.039 * 1000),
      9,
    );
  });

  it("breakEvenClickCvr = effectiveCpc / (aov * grossMargin) — Gemini's 3.42%", () => {
    // €1.00 CPC, €45 AOV, 65% GM → 1/(45*0.65) = 1/29.25 = 0.0342.
    expect(
      breakEvenClickCvr(cpc({ cpc: 1.0, aov: 45, grossMargin: 0.65 })),
    ).toBeCloseTo(1 / 29.25, 6);
  });

  it("breakEvenClickCvr with LTV divides by the extra M (lower bar)", () => {
    // M = 1.3 → 1/(29.25*1.3) = 1/38.025 = 0.0263.
    expect(
      breakEvenClickCvr(cpc({ cpc: 1.0, aov: 45, grossMargin: 0.65, ltvMultiplier: 1.3 }), true),
    ).toBeCloseTo(1 / 38.025, 6);
  });

  it("breakEvenCpa equals gross profit per unit (aov * gm)", () => {
    expect(breakEvenCpa(cpc({ aov: 45, grossMargin: 0.65 }))).toBeCloseTo(29.25, 9);
  });

  it("breakEvenClickCvr is undefined when gross profit is 0", () => {
    expect(breakEvenClickCvr(cpc({ aov: 0 }))).toBeUndefined();
  });
});

describe("profit, LTV and min daily budget (Gemini's unit economics)", () => {
  it("profitPerSale = aov*gm − cpa; negative at a loss", () => {
    // €45, 65% GM → €29.25 gross profit/unit. 1250 clicks * 0.015 = 18.75 conv.
    // CPA = 500/18.75 = €26.67 → profit/sale = 29.25 − 26.67 = €2.58.
    const p = runCpc(cpc());
    expect(p.profitPerSale).toBeCloseTo(29.25 - 500 / 18.75, 6);
    expect(p.profitPerSale as number).toBeGreaterThan(0);
  });

  it("totalProfit = grossProfit − spend", () => {
    const p = runCpc(cpc());
    expect(p.grossProfit).toBeCloseTo(18.75 * 29.25, 6);
    expect(p.totalProfit).toBeCloseTo(18.75 * 29.25 - 500, 6);
  });

  it("profitPerSaleLtv credits the repeat multiplier", () => {
    const p = runCpc(cpc({ ltvMultiplier: 1.3 }));
    const cpa = 500 / 18.75;
    expect(p.profitPerSaleLtv).toBeCloseTo(29.25 * 1.3 - cpa, 6);
  });

  it("minDailyBudget = (50/7) * cpa — Meta learning phase is 50 events/ad set/7d", () => {
    // Construct a CPA of exactly €40: spend/conversions = 40.
    // 1250 clicks * cvr = conversions; pick cvr so 500/conversions = 40 → conv=12.5
    // → cvr = 12.5/1250 = 0.01.
    const p = runCpc(cpc({ clickCvr: 0.01 }));
    expect(p.cpa).toBeCloseTo(40, 6);
    expect(p.minDailyBudget).toBeCloseTo((50 / 7) * 40, 4); // ≈ 285.71
  });

  it("minDailyBudget is undefined when CPA is (zero conversions)", () => {
    expect(runCpc(cpc({ clickCvr: 0 })).minDailyBudget).toBeUndefined();
  });
});

describe("VAT handling — profit/break-even use net AOV, revenue/ROAS stay gross", () => {
  // Fixtures omit vatRate (defaults to 0 in the pure layer), so we set it
  // explicitly here. At 20% VAT a €45 gross AOV nets €37.50 (45/1.2).
  const NET_45_AT_20 = 45 / 1.2; // 37.5

  it("netAov strips VAT: aov / (1 + vatRate)", () => {
    expect(netAov(cpc({ aov: 45, vatRate: 0.2 }))).toBeCloseTo(37.5, 9);
  });

  it("netAov returns gross AOV unchanged when vatRate is unset (0)", () => {
    expect(netAov(cpc({ aov: 45 }))).toBeCloseTo(45, 9);
  });

  it("revenue stays GROSS (uses aov, not netAov)", () => {
    // 1250 clicks * 0.015 = 18.75 conv * €45 gross = €843.75 — unchanged by VAT.
    const p = runCpc(cpc({ vatRate: 0.2 }));
    expect(p.revenue).toBeCloseTo(843.75, 6);
  });

  it("netRevenue = conversions * netAov = revenue / (1 + vatRate)", () => {
    const p = runCpc(cpc({ vatRate: 0.2 }));
    expect(p.netRevenue).toBeCloseTo(18.75 * NET_45_AT_20, 6); // 703.125
    expect(p.netRevenue).toBeCloseTo((p.revenue as number) / 1.2, 6);
  });

  it("ROAS stays GROSS (revenue / spend), independent of VAT", () => {
    const gross = runCpc(cpc()); // vatRate 0
    const withVat = runCpc(cpc({ vatRate: 0.2 }));
    expect(withVat.roas).toBeCloseTo(gross.roas as number, 9);
    expect(withVat.roas).toBeCloseTo(843.75 / 500, 6);
  });

  it("gross profit per unit uses NET aov * gm → totalProfit drops vs gross", () => {
    // NET €37.50 * 0.65 = €24.375/unit. 18.75 conv → grossProfit €457.03.
    const p = runCpc(cpc({ vatRate: 0.2, grossMargin: 0.65 }));
    expect(p.grossProfit).toBeCloseTo(18.75 * NET_45_AT_20 * 0.65, 6);
    expect(p.totalProfit).toBeCloseTo(18.75 * NET_45_AT_20 * 0.65 - 500, 6);
    // Strictly less profit than the no-VAT run (the bug this fixes).
    expect(p.totalProfit as number).toBeLessThan(
      runCpc(cpc({ grossMargin: 0.65 })).totalProfit as number,
    );
  });

  it("profitPerSale = netAov*gm − cpa", () => {
    const p = runCpc(cpc({ vatRate: 0.2, grossMargin: 0.65 }));
    const cpa = 500 / 18.75;
    expect(p.profitPerSale).toBeCloseTo(NET_45_AT_20 * 0.65 - cpa, 6);
  });

  it("breakEvenCpa = netAov * gm (lower than the gross figure)", () => {
    // NET €37.50 * 0.65 = €24.375 (vs €29.25 gross).
    expect(breakEvenCpa(cpc({ aov: 45, grossMargin: 0.65, vatRate: 0.2 }))).toBeCloseTo(
      NET_45_AT_20 * 0.65,
      9,
    );
  });

  it("breakEvenClickCvr uses net AOV → a HIGHER (harder) bar than gross", () => {
    // €1 CPC, net €37.50, 65% GM → 1/(37.5*0.65) = 1/24.375 = 0.04103.
    const withVat = breakEvenClickCvr(
      cpc({ cpc: 1.0, aov: 45, grossMargin: 0.65, vatRate: 0.2 }),
    ) as number;
    const gross = breakEvenClickCvr(
      cpc({ cpc: 1.0, aov: 45, grossMargin: 0.65 }),
    ) as number;
    expect(withVat).toBeCloseTo(1 / 24.375, 6);
    expect(withVat).toBeGreaterThan(gross); // VAT raises the break-even bar
  });

  it("back-compat: vatRate 0 reproduces the original gross numbers exactly", () => {
    const zero = runCpc(cpc({ vatRate: 0 }));
    const unset = runCpc(cpc());
    expect(zero.totalProfit).toBeCloseTo(unset.totalProfit as number, 9);
    expect(zero.grossProfit).toBeCloseTo(unset.grossProfit as number, 9);
    expect(zero.netRevenue).toBeCloseTo(unset.revenue as number, 9); // net === gross at 0 VAT
  });
});

describe("runProjection dispatch", () => {
  it("routes cpm scenarios to the CPM funnel", () => {
    expect(runProjection(cpm()).impressions).toBeDefined();
  });
  it("routes cpc scenarios to the CPC funnel (no impressions)", () => {
    expect(runProjection(cpc()).impressions).toBeUndefined();
  });
  it("routes cps scenarios to the CPS funnel", () => {
    expect(runProjection(cps()).conversions).toBeDefined();
  });
});

// CPS (conversion / target-CPA bid) fixture: no cpc/cpm/ctr/grain.
function cps(overrides: Partial<Scenario> = {}): Scenario {
  return {
    model: "cps",
    budget: 500,
    spend: 500,
    targetCpa: 20,
    aov: 45,
    grossMargin: 0.65,
    ltvMultiplier: 1,
    ...overrides,
  };
}

describe("runCps — conversions bought directly at target CPA", () => {
  it("conversions = budget / targetCpa", () => {
    // €500 / €20 = 25 conversions.
    expect(runCps(cps()).conversions).toBeCloseTo(25, 9);
  });
  it("CPA in the projection equals targetCpa by construction (spend === budget)", () => {
    expect(runCps(cps({ targetCpa: 20 })).cpa).toBeCloseTo(20, 9);
  });
  it("leaves clicks, impressions, sessions undefined (no traffic stage)", () => {
    const p = runCps(cps());
    expect(p.clicks).toBeUndefined();
    expect(p.impressions).toBeUndefined();
    expect(p.sessions).toBeUndefined();
  });
  it("shares the money tail: revenue gross, netRevenue ex-VAT, profit on net", () => {
    const p = runCps(cps({ vatRate: 0.2 }));
    expect(p.revenue).toBeCloseTo(25 * 45, 6); // gross
    expect(p.netRevenue).toBeCloseTo(25 * (45 / 1.2), 6);
    // grossProfit = conversions × netAov × gm = 25 × 37.5 × 0.65
    expect(p.grossProfit).toBeCloseTo(25 * (45 / 1.2) * 0.65, 6);
    expect(p.totalProfit).toBeCloseTo(25 * (45 / 1.2) * 0.65 - 500, 6);
  });
  it("break-even CPA still computes (net AOV × gm); break-even CVR is undefined (no click price)", () => {
    const p = runCps(cps({ vatRate: 0.2 }));
    expect(p.breakEvenCpa).toBeCloseTo((45 / 1.2) * 0.65, 6);
    expect(p.breakEvenCvr).toBeUndefined();
  });
  it("undefined targetCpa → conversions undefined, CPA undefined (not Infinity)", () => {
    const p = runCps(cps({ targetCpa: undefined }));
    expect(p.conversions).toBeUndefined();
    expect(p.cpa).toBeUndefined();
  });
  it("min daily budget uses the corrected 50-event learning phase", () => {
    // CPA €20 → (50/7) × 20 ≈ 142.86.
    expect(runCps(cps({ targetCpa: 20 })).minDailyBudget).toBeCloseTo((50 / 7) * 20, 4);
  });
});

describe("impliedFromCps — back out the traffic prices a target CPA implies", () => {
  it("impliedCpc = targetCpa × assumed clickCvr", () => {
    // €20 CPA × 1.5% CVR = €0.30 implied CPC.
    const { impliedCpc } = impliedFromCps(cps({ targetCpa: 20 }), { clickCvr: 0.015 });
    expect(impliedCpc).toBeCloseTo(0.3, 9);
  });
  it("impliedCpm = impliedCpc × ctr × 1000", () => {
    // impliedCpc €0.30, CTR 4% → CPM = 0.30 × 0.04 × 1000 = €12.
    const { impliedCpm } = impliedFromCps(cps({ targetCpa: 20 }), { clickCvr: 0.015, ctr: 0.04 });
    expect(impliedCpm).toBeCloseTo(12, 6);
  });
  it("undefined when CVR is missing (can't relate results to clicks)", () => {
    const r = impliedFromCps(cps({ targetCpa: 20 }), {});
    expect(r.impliedCpc).toBeUndefined();
    expect(r.impliedCpm).toBeUndefined();
  });
  it("impliedCpm undefined when ctr missing but impliedCpc still computed", () => {
    const r = impliedFromCps(cps({ targetCpa: 20 }), { clickCvr: 0.015 });
    expect(r.impliedCpc).toBeCloseTo(0.3, 9);
    expect(r.impliedCpm).toBeUndefined();
  });
});
