import { describe, it, expect, vi } from "vitest";
import { render, screen, within } from "@testing-library/react";
import Overview from "../Overview";
import type { AirtableRecord } from "@/lib/utils";

// Chart.js needs a real canvas context; the KPI behavior under test doesn't.
vi.mock("react-chartjs-2", () => ({
  Line: () => null,
  Bar: () => null,
}));

let recId = 0;
function makeRecord(fields: Record<string, unknown>): AirtableRecord {
  return {
    id: `rec_${recId++}`,
    fields,
    createdTime: "2026-01-01T00:00:00.000Z",
  };
}

// Mirrors the real post-OPS-53 data shapes: IG reports Reach but its
// Impressions key is absent (null in DB -> sparse record); FB/Pinterest
// report Impressions but write bogus 0 for Reach.
const igReach = (date: string, reach: number, followers = 600) =>
  makeRecord({
    Platform: "Instagram",
    Date: date,
    Reach: reach,
    Followers: followers,
  });
const fbImpressions = (date: string, impressions: number) =>
  makeRecord({
    Platform: "Facebook",
    Date: date,
    Reach: 0,
    Impressions: impressions,
    Followers: 100,
  });
const pinImpressions = (date: string, impressions: number) =>
  makeRecord({
    Platform: "Pinterest",
    Date: date,
    Reach: 0,
    Impressions: impressions,
    Followers: 50,
  });

function renderOverview(
  dailyMetrics: AirtableRecord[],
  prevDailyMetrics: AirtableRecord[] = [],
) {
  return render(
    <Overview
      posts={[]}
      dailyMetrics={dailyMetrics}
      alerts={[]}
      weeklySummaries={[]}
      prevPosts={[]}
      prevDailyMetrics={prevDailyMetrics}
    />,
  );
}

function kpiCard(title: string): HTMLElement {
  const el = screen.getByText(title).closest(".rounded-xl");
  if (!el) throw new Error(`KPI card for "${title}" not found`);
  return el as HTMLElement;
}

describe("Overview KPI titles (WEBDEV-189)", () => {
  it("qualifies Reach and Impressions titles with the reporting platforms", () => {
    renderOverview([
      igReach("2026-06-01", 120),
      fbImpressions("2026-06-01", 454),
      pinImpressions("2026-06-01", 5234),
    ]);

    // wiring check: titles must come from reachPlatforms/impressionsPlatforms,
    // not from the full platform list
    expect(screen.getByText("Reach (IG)")).toBeTruthy();
    expect(screen.getByText("Impressions (FB + Pinterest)")).toBeTruthy();
  });

  it("shows bare titles when only one platform is present and reports", () => {
    renderOverview([fbImpressions("2026-06-01", 454)]);

    expect(screen.getByText("Impressions")).toBeTruthy();
    expect(screen.getByText("Reach")).toBeTruthy();
  });
});

describe("Overview KPI em-dash gating (WEBDEV-189)", () => {
  it("shows — for Reach when no platform reports it (FB bogus zeros)", () => {
    renderOverview([fbImpressions("2026-06-01", 454)]);

    const reachCard = kpiCard("Reach");
    expect(within(reachCard).getByText("—")).toBeTruthy();
    // and the real metric still renders
    const imprCard = kpiCard("Impressions");
    expect(within(imprCard).getByText("454")).toBeTruthy();
  });

  it("shows the Reach value when IG reports it", () => {
    renderOverview([igReach("2026-06-01", 120)]);

    const reachCard = kpiCard("Reach");
    expect(within(reachCard).getByText("120")).toBeTruthy();
    expect(within(reachCard).queryByText("—")).toBeNull();
  });
});

describe("Overview prev-period comparison scope (WEBDEV-189)", () => {
  it("compares Reach against the same platform scope the value sums", () => {
    // Current: only IG reports reach (120). Previous period: IG had 100 and
    // Pinterest had a bogus 999. Scoped comparison = 120 vs 100 = +20.0%.
    // An unscoped flat sum would compare 120 vs 1099 = -89.1%.
    renderOverview(
      [igReach("2026-06-08", 120), fbImpressions("2026-06-08", 454)],
      [
        igReach("2026-06-01", 100),
        makeRecord({
          Platform: "Pinterest",
          Date: "2026-06-01",
          Reach: 999,
          Followers: 50,
        }),
      ],
    );

    const reachCard = kpiCard("Reach (IG)");
    expect(reachCard.textContent).toContain("20.0%");
    expect(reachCard.textContent).not.toContain("89.1%");
  });
});
