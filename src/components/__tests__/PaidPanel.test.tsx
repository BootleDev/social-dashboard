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
    expect(screen.getByText(/Verdict — what should I do/)).toBeInTheDocument();
    // Default (provisional 0.2% CVR) is below break-even → HOLD.
    expect(screen.getByText("HOLD")).toBeInTheDocument();
  });

  it("shows the data-freshness banner for the stale ad baseline", async () => {
    await renderPaid();
    expect(screen.getByText(/Ad-pricing baseline is .* days old/)).toBeInTheDocument();
    expect(screen.getByText(/last recorded ad spend was 2026-01-22/)).toBeInTheDocument();
  });

  it("surfaces a concrete DO/DON'T recommendation", async () => {
    await renderPaid();
    // At the provisional CVR the funnel can't deliver → DON'T spend.
    expect(screen.getByText("DON'T")).toBeInTheDocument();
  });

  it("CVR override flows through and moves the projection (legibility line updates)", async () => {
    await renderPaid();
    // The live readout shows the default provisional CVR (0.20%).
    expect(screen.getByText(/achievable CPA/)).toBeInTheDocument();
    // Type a higher CVR; the achievable-CPA readout must recompute lower.
    const cvrInput = screen.getByPlaceholderText("0.20") as HTMLInputElement;
    fireEvent.change(cvrInput, { target: { value: "2" } });
    await waitFor(() =>
      // At 2% CVR, achievable CPA = 0.34/0.02 = €17 — appears somewhere.
      expect(screen.getAllByText(/€17/).length).toBeGreaterThan(0),
    );
  });
});
