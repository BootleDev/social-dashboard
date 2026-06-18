import { describe, it, expect } from "vitest";
import { resolveScenario, simulate, type ScenarioOverrides } from "../adSimulate";
import { DEFAULT_VAT_RATE, type Baseline, type EstimateWithConfidence } from "../adScenario";

function est(
  value: number | undefined,
  confidence: EstimateWithConfidence["confidence"] = "ok",
  n = 1000,
): EstimateWithConfidence {
  return { value, n, confidence };
}

function baseline(overrides: Partial<Baseline> = {}): Baseline {
  return {
    cpc: est(0.4),
    cpm: est(12),
    ctr: est(0.039),
    clickCvr: est(0.015),
    clickCvrInterval: { low: 0.01, high: 0.02 },
    aov: est(45),
    shopifyAov: est(65),
    counts: { adPurchases: 20, adClicks: 1300, storeOrders: 30 },
    window: { start: "2026-01-01", end: "2026-01-31", days: 20 },
    currency: "EUR",
    flags: {
      mixedCurrency: false,
      droppedCurrencyRows: 0,
      droppedNegativeGrossRows: 0,
      droppedCompRows: 0,
      droppedPhantomConversions: 0,
      latestSpendDate: "2026-01-31",
    },
    ...overrides,
  };
}

function overrides(o: Partial<ScenarioOverrides> = {}): ScenarioOverrides {
  return { model: "cpc", budget: 500, contributionMargin: 0.65, ...o };
}

describe("resolveScenario — overrides onto baseline", () => {
  it("takes values from the baseline when no override is set", () => {
    const s = resolveScenario(baseline(), overrides());
    expect(s.cpc).toBe(0.4);
    expect(s.aov).toBe(45);
    expect(s.clickCvr).toBe(0.015);
    expect(s.spend).toBe(500); // defaults to budget
  });

  it("an override wins over the baseline estimate", () => {
    const s = resolveScenario(baseline(), overrides({ cpc: 0.25, aov: 60 }));
    expect(s.cpc).toBe(0.25);
    expect(s.aov).toBe(60);
  });

  it("switching to session grain clears the baseline click CVR", () => {
    const s = resolveScenario(
      baseline(),
      overrides({ bounceRate: 0.4, sessionCvr: 0.025 }),
    );
    expect(s.clickCvr).toBeUndefined();
    expect(s.bounceRate).toBe(0.4);
    expect(s.sessionCvr).toBe(0.025);
  });

  it("throws when a CPM run lacks ctr from both override and baseline", () => {
    const b = baseline({ ctr: est(undefined, "none", 0) });
    expect(() => resolveScenario(b, overrides({ model: "cpm" }))).toThrow(
      /missing.*ctr/,
    );
  });

  it("throws when AOV is unavailable (below guard, no override)", () => {
    const b = baseline({ aov: est(undefined, "none", 0) });
    expect(() => resolveScenario(b, overrides())).toThrow(/missing.*aov/);
  });

  it("reports missing clickCvr (not a generic grain error) when CVR is below guard with no override", () => {
    const b = baseline({ clickCvr: est(undefined, "none", 0) });
    expect(() => resolveScenario(b, overrides())).toThrow(/missing.*clickCvr/);
  });

  it("throws on a percent-scale CTR override (sentinel)", () => {
    expect(() =>
      resolveScenario(baseline(), overrides({ model: "cpm", ctr: 3.9 })),
    ).toThrow(/\[sim-input\]/);
  });

  it("rejects a half-specified session grain", () => {
    expect(() =>
      resolveScenario(baseline(), overrides({ bounceRate: 0.4 })),
    ).toThrow(/grain/);
  });
});

describe("resolveScenario — CPS (conversion-bid) model", () => {
  it("resolves with targetCpa and carries NO cvr grain or click price", () => {
    const s = resolveScenario(baseline(), overrides({ model: "cps", targetCpa: 20 }));
    expect(s.model).toBe("cps");
    expect(s.targetCpa).toBe(20);
    expect(s.clickCvr).toBeUndefined();
    expect(s.bounceRate).toBeUndefined();
    expect(s.sessionCvr).toBeUndefined();
    expect(s.cpc).toBeUndefined();
    expect(s.cpm).toBeUndefined();
    expect(s.ctr).toBeUndefined();
  });

  it("throws an actionable error when targetCpa is missing", () => {
    expect(() => resolveScenario(baseline(), overrides({ model: "cps" }))).toThrow(
      /missing.*targetCpa/,
    );
  });

  it("still requires AOV (revenue basis)", () => {
    const b = baseline({ aov: est(undefined, "none", 0) });
    expect(() => resolveScenario(b, overrides({ model: "cps", targetCpa: 20 }))).toThrow(
      /missing.*aov/,
    );
  });

  it("rejects a negative targetCpa via the non-negative sentinel", () => {
    expect(() =>
      resolveScenario(baseline(), overrides({ model: "cps", targetCpa: -5 })),
    ).toThrow(/\[sim-input\]/);
  });

  it("does NOT require a conversion grain (cps has no funnel)", () => {
    // baseline clickCvr is below guard → would throw for cpc, but cps ignores it.
    const b = baseline({ clickCvr: est(undefined, "none", 0) });
    expect(() =>
      resolveScenario(b, overrides({ model: "cps", targetCpa: 20 })),
    ).not.toThrow();
  });
});

describe("resolveScenario — VAT rate", () => {
  it("defaults vatRate to DEFAULT_VAT_RATE (0.20 UK) when no override", () => {
    const s = resolveScenario(baseline(), overrides());
    expect(s.vatRate).toBe(DEFAULT_VAT_RATE);
    expect(s.vatRate).toBe(0.2);
  });

  it("an explicit vatRate override wins over the default", () => {
    const s = resolveScenario(baseline(), overrides({ vatRate: 0.19 }));
    expect(s.vatRate).toBe(0.19);
  });

  it("allows vatRate 0 (explicit no-VAT, e.g. US ex-VAT pricing)", () => {
    const s = resolveScenario(baseline(), overrides({ vatRate: 0 }));
    expect(s.vatRate).toBe(0);
  });

  it("throws on an out-of-range vatRate (> 1) via the fraction sentinel", () => {
    expect(() =>
      resolveScenario(baseline(), overrides({ vatRate: 1.5 })),
    ).toThrow(/\[sim-input\]/);
  });
});

describe("simulate — low/expected/high band", () => {
  const s = resolveScenario(baseline(), overrides());
  const r = simulate(s);

  it("expected matches the point-estimate run", () => {
    expect(r.expected.conversions).toBeCloseTo(1250 * 0.015, 6);
  });

  it("monotonic: low <= expected <= high on conversions", () => {
    expect(r.low.conversions as number).toBeLessThanOrEqual(
      r.expected.conversions as number,
    );
    expect(r.expected.conversions as number).toBeLessThanOrEqual(
      r.high.conversions as number,
    );
  });

  it("monotonic on revenue", () => {
    expect(r.low.revenue as number).toBeLessThanOrEqual(r.expected.revenue as number);
    expect(r.expected.revenue as number).toBeLessThanOrEqual(r.high.revenue as number);
  });

  it("high ROAS >= expected ROAS >= low ROAS (cheaper price + higher CVR helps both)", () => {
    expect(r.high.roas as number).toBeGreaterThanOrEqual(r.expected.roas as number);
    expect(r.expected.roas as number).toBeGreaterThanOrEqual(r.low.roas as number);
  });

  it("low run perturbs CVR down and price up", () => {
    // low conversions = 1250 clicks-at-higher-cpc * (cvr * 0.65).
    // clicks at cpc*1.2 = 500/(0.4*1.2)=1041.67; * (0.015*0.65)=10.156.
    const lowClicks = 500 / (0.4 * 1.2);
    expect(r.low.conversions).toBeCloseTo(lowClicks * 0.015 * 0.65, 5);
  });
});

describe("simulate — flags", () => {
  it("flags low confidence when a baseline estimate is thin", () => {
    const b = baseline({ clickCvr: est(0.015, "low", 80) });
    const s = resolveScenario(b, overrides());
    const r = simulate(s, { baseline: b });
    expect(r.flags.lowConfidence).toBe(true);
  });

  it("flags defaultedBounce on a click-grain run", () => {
    const r = simulate(resolveScenario(baseline(), overrides()));
    expect(r.flags.defaultedBounce).toBe(true);
  });

  it("does not flag defaultedBounce on a session-grain run", () => {
    const s = resolveScenario(
      baseline(),
      overrides({ bounceRate: 0.4, sessionCvr: 0.025 }),
    );
    expect(simulate(s).flags.defaultedBounce).toBe(false);
  });

  it("carries mixedCurrency from the baseline", () => {
    const b = baseline({
      flags: {
        mixedCurrency: true,
        droppedCurrencyRows: 2,
        droppedNegativeGrossRows: 0,
        droppedCompRows: 0,
        droppedPhantomConversions: 0,
        latestSpendDate: "2026-01-31",
      },
    });
    const r = simulate(resolveScenario(b, overrides()), { baseline: b });
    expect(r.flags.mixedCurrency).toBe(true);
  });
});

describe("simulate — CVR band clamps at 1", () => {
  it("does not push a high CVR above 1.0", () => {
    const b = baseline({ clickCvr: est(0.9) });
    const s = resolveScenario(b, overrides());
    const r = simulate(s);
    // high run scales cvr by 1.35 → would be 1.215, clamped to 1.0.
    const highClicks = 500 / (0.4 * 0.8);
    expect(r.high.conversions).toBeCloseTo(highClicks * 1.0, 5);
  });
});
