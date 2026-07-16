import "@testing-library/jest-dom";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor, cleanup } from "@testing-library/react";
import PaidPanel from "../PaidPanel";
import type { Baseline } from "@/lib/adScenario";

// Stale baseline (ad spend ended Jan; Shopify fresh) — Bootle's real shape.
const baseline: Baseline = {
  cpc: { value: 0.34, n: 2793, confidence: "ok" },
  cpm: { value: 16.05, n: 50000, confidence: "ok" },
  ctr: { value: 0.0471, n: 50000, confidence: "ok" },
  clickCvr: { value: 0.0019, n: 2793, confidence: "low" },
  clickCvrInterval: { low: 0.0008, high: 0.0045 },
  aov: { value: 49.81, n: 5, confidence: "low" },
  shopifyAov: { value: 65.12, n: 15, confidence: "ok" },
  counts: { adPurchases: 5, adClicks: 2793, storeOrders: 15 },
  window: { start: "2026-01-10", end: "2026-01-22", days: 13 },
  currency: "EUR",
  flags: {
    mixedCurrency: false,
    droppedCurrencyRows: 0,
    droppedNegativeGrossRows: 0,
    droppedCompRows: 0,
    droppedPhantomConversions: 0,
    latestSpendDate: "2026-01-22",
  },
};

const apiPayload = {
  baseline,
  freshShopifyAov: { value: 67.85, n: 130, confidence: "ok" },
  daily: [],
  shopify: [],
  window: { start: "2026-01-10", end: "2026-01-22" },
};

beforeEach(() => {
  window.localStorage.clear();
  global.fetch = vi.fn(() =>
    Promise.resolve({ ok: true, json: () => Promise.resolve(apiPayload) } as Response),
  );
});
afterEach(() => cleanup());

async function renderPaid() {
  render(<PaidPanel posts={[]} />);
  // Wait past the loading state once the mocked fetch resolves.
  await waitFor(() => expect(screen.queryByText(/Loading paid data/)).not.toBeInTheDocument());
}

describe("PaidPanel wiring", () => {
  it("renders the verdict once data loads", async () => {
    await renderPaid();
    // The verdict leads with a plain headline + a HOLD badge.
    expect(screen.getByText(/Don’t spend yet/)).toBeInTheDocument();
    // HOLD is driven by the MEASURED rate — baseline.clickCvr (0.19%: 5 ad
    // purchases / 2,793 clicks, January) — NOT by PROVISIONAL_SESSION_CVR.
    // That constant is only a fallback when clickCvr is null. Before 2026-07-16
    // both happened to be ~0.2% and this distinction was invisible; correcting
    // the site CVR to 1.5% (WEBDEV-601) separated them. See WEBDEV-581.
    expect(screen.getByText("HOLD")).toBeInTheDocument();
    // The canonical CPA comparison is anchored in the verdict: the modeled
    // target (CPC ÷ site CVR) against what the measured ad funnel delivers
    // (CPC ÷ clickCvr = 0.34/0.0019 ≈ €179).
    expect(screen.getByText(/can only deliver/)).toBeInTheDocument();
    // "break-even" appears in the verdict line and again in the inputs table.
    expect(screen.getAllByText(/break-even/).length).toBeGreaterThan(0);
  });

  it("shows the data-freshness banner for the stale ad baseline", async () => {
    await renderPaid();
    expect(screen.getByText(/Ad-pricing baseline is .* days old/)).toBeInTheDocument();
    expect(screen.getByText(/last recorded ad spend was 2026-01-22/)).toBeInTheDocument();
  });

  it("surfaces a concrete spend/hold recommendation", async () => {
    await renderPaid();
    // The advisor line is labelled "Recommended next step"; at the provisional
    // CVR the funnel can't deliver, so the summary tells the operator not to spend.
    expect(screen.getAllByText(/Recommended next step/i).length).toBeGreaterThan(0);
    expect(
      screen.getAllByText(/Don't spend yet|conversion rate must rise/i).length,
    ).toBeGreaterThan(0);
  });

  it("CVR override flows through and moves the projection (legibility line updates)", async () => {
    await renderPaid();
    // The causal line by the CVR input maps the rate to a cost per sale
    // ("cost per sale" also appears in the verdict summary, so allow multiple).
    expect(screen.getAllByText(/cost per sale/).length).toBeGreaterThan(0);
    // Type a higher CVR; the derived cost-per-sale must recompute lower.
    // Placeholder tracks PROVISIONAL_SESSION_CVR — 1.50 since WEBDEV-601
    // (was 0.20, a figure that divided by Shopify's bot-inflated sessions).
    const cvrInput = screen.getByPlaceholderText("1.50") as HTMLInputElement;
    fireEvent.change(cvrInput, { target: { value: "2" } });
    await waitFor(() =>
      // At 2% CVR, achievable CPA = 0.34/0.02 = €17 — appears somewhere.
      expect(screen.getAllByText(/€17/).length).toBeGreaterThan(0),
    );
  });

  it("conversion-bid mode exposes NO editable Target CPA field (CPA is derived)", async () => {
    await renderPaid();
    // The disconnect came from a free Target-CPA input that could contradict CVR.
    // It's gone; CPA shows as a read-only derived figure instead.
    expect(screen.queryByText("Target CPA (€)")).not.toBeInTheDocument();
    expect(screen.getByText("Achievable CPA (€)")).toBeInTheDocument();
    expect(screen.getAllByText(/derived/i).length).toBeGreaterThan(0);
  });

  it("editing CVR moves the PROJECTION output, not just the readout line", async () => {
    await renderPaid();
    // The Projection table is collapsed by default (answer-first) — expand it so
    // the conversion figures are in the DOM.
    fireEvent.click(screen.getByText(/^Projection —/));
    // The bug under test: the projection output must reflect the CVR input in
    // conversion-bid mode (previously a pinned CPA made it inert). Assert it by
    // moving CVR an order of magnitude and watching the conversions figure gain
    // a digit.
    //
    // Anchored on the default (PROVISIONAL_SESSION_CVR = 1.50% since
    // WEBDEV-601; was 0.20%). At 1.5%, achievable CPA = 0.34/0.015 ≈ €22.62, so
    // €500 ÷ €22.62 ≈ 22 conversions — a two-digit "NN.NN".
    expect(screen.getAllByText(/^[1-9][0-9]\.[0-9]{2}$/).length).toBeGreaterThan(0);
    const cvrInput = screen.getByPlaceholderText("1.50") as HTMLInputElement;
    // Raise CVR 10× → achievable CPA drops 10× → conversions gain a digit.
    fireEvent.change(cvrInput, { target: { value: "15" } });
    await waitFor(() => {
      // At 15%: CPA = 0.34/0.15 ≈ €2.27 → €500 ÷ €2.27 ≈ 220 — a three-digit
      // "NNN.NN" figure now appears where none existed before.
      expect(screen.getAllByText(/^[1-9][0-9]{2}\.[0-9]{2}$/).length).toBeGreaterThan(0);
    });
  });

  it("forecast shows site visitors + A/B feasibility (even in conversion-bid mode)", async () => {
    await renderPaid();
    // "What this spend buys" is collapsed by default — expand it (click the button,
    // not the inner text node, so the toggle fires).
    fireEvent.click(screen.getByText(/^What this spend buys/).closest("button")!);
    // Site visitors are computed in cps mode now (spend ÷ CPC), not blanked out.
    expect(screen.getByText(/Site visitors/)).toBeInTheDocument();
    expect(screen.getByText(/Can you A\/B test/)).toBeInTheDocument();
    expect(screen.getByText(/On-site test/)).toBeInTheDocument();
    expect(screen.getByText(/Purchase-rate test/)).toBeInTheDocument();
    // The editable planning budget field exists.
    expect(screen.getByText(/Forecast at/)).toBeInTheDocument();
  });
});
