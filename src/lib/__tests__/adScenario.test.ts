import { describe, it, expect } from "vitest";
import {
  assertFractionInputs,
  assertNonNegativeInputs,
  validateScenarioGrain,
  BASELINE_GUARDS,
  DEFAULT_BANDS,
  type Scenario,
} from "../adScenario";

function clickScenario(overrides: Partial<Scenario> = {}): Scenario {
  return {
    model: "cpc",
    budget: 500,
    spend: 500,
    cpc: 0.4,
    aov: 45,
    contributionMargin: 0.65,
    ltvMultiplier: 1,
    clickCvr: 0.015,
    ...overrides,
  };
}

describe("assertFractionInputs", () => {
  it("passes when all populated rate fields are in [0,1]", () => {
    expect(() => assertFractionInputs(clickScenario())).not.toThrow();
  });

  it("throws on a percent-scale CTR (3.9 instead of 0.039)", () => {
    const s = clickScenario({ model: "cpm", cpc: undefined, cpm: 12, ctr: 3.9 });
    expect(() => assertFractionInputs(s)).toThrow(/\[sim-input\].*ctr/);
  });

  it("throws on a negative rate", () => {
    expect(() => assertFractionInputs(clickScenario({ clickCvr: -0.01 }))).toThrow(
      /\[sim-input\]/,
    );
  });

  it("throws on bounceRate > 1", () => {
    const s = clickScenario({
      clickCvr: undefined,
      bounceRate: 1.2,
      sessionCvr: 0.02,
    });
    expect(() => assertFractionInputs(s)).toThrow(/bounceRate/);
  });

  it("ignores undefined fraction fields", () => {
    const s = clickScenario({ clickCvr: 0.02 }); // ctr/bounce/session undefined
    expect(() => assertFractionInputs(s)).not.toThrow();
  });
});

describe("assertNonNegativeInputs", () => {
  it("passes for finite non-negative counts/prices", () => {
    expect(() => assertNonNegativeInputs(clickScenario())).not.toThrow();
  });

  it("throws on negative cpc", () => {
    expect(() => assertNonNegativeInputs(clickScenario({ cpc: -1 }))).toThrow(
      /cpc/,
    );
  });

  it("throws on non-finite budget", () => {
    expect(() =>
      assertNonNegativeInputs(clickScenario({ budget: Infinity })),
    ).toThrow(/budget/);
  });

  it("allows zero budget (a valid edge — yields a zero projection)", () => {
    expect(() =>
      assertNonNegativeInputs(clickScenario({ budget: 0, spend: 0 })),
    ).not.toThrow();
  });
});

describe("validateScenarioGrain", () => {
  it("accepts click grain (clickCvr only)", () => {
    const r = validateScenarioGrain(clickScenario());
    expect(r).toEqual({ ok: true, grain: "click" });
  });

  it("accepts session grain (bounceRate + sessionCvr, no clickCvr)", () => {
    const s = clickScenario({
      clickCvr: undefined,
      bounceRate: 0.5,
      sessionCvr: 0.03,
    });
    expect(validateScenarioGrain(s)).toEqual({ ok: true, grain: "session" });
  });

  it("rejects both grains set at once", () => {
    const s = clickScenario({ bounceRate: 0.5, sessionCvr: 0.03 });
    const r = validateScenarioGrain(s);
    expect(r.ok).toBe(false);
  });

  it("rejects a half-specified session grain (bounce without sessionCvr)", () => {
    const s = clickScenario({ clickCvr: undefined, bounceRate: 0.5 });
    const r = validateScenarioGrain(s);
    expect(r.ok).toBe(false);
  });

  it("rejects no grain at all", () => {
    const s = clickScenario({ clickCvr: undefined });
    const r = validateScenarioGrain(s);
    expect(r.ok).toBe(false);
  });
});

describe("constants", () => {
  it("CVR guard requires more volume than the price guard", () => {
    expect(BASELINE_GUARDS.minClicksForCvr).toBeGreaterThan(
      BASELINE_GUARDS.minClicks,
    );
  });

  it("CVR band is wider than the price band (CVR is noisier)", () => {
    expect(DEFAULT_BANDS.cvrBand).toBeGreaterThan(DEFAULT_BANDS.priceBand);
  });
});
