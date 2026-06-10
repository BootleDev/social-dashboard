import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, within } from "@testing-library/react";
import PlatformCompare from "../PlatformCompare";
import type { AirtableRecord } from "@/lib/utils";

// Capture the data each <Line> chart receives instead of rendering canvas.
const { lineCharts } = vi.hoisted(() => ({
  lineCharts: [] as Array<{ datasets: Array<{ label: string }> }>,
}));
vi.mock("react-chartjs-2", () => ({
  Line: (props: { data: { datasets: Array<{ label: string }> } }) => {
    lineCharts.push(props.data);
    return null;
  },
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

// Real post-OPS-53 shapes: IG = reach only (impressions null/absent),
// FB/Pinterest = impressions + bogus zero reach.
const fixtures = [
  makeRecord({
    Platform: "Instagram",
    Date: "2026-06-01",
    Reach: 120,
    Followers: 600,
  }),
  makeRecord({
    Platform: "Facebook",
    Date: "2026-06-01",
    Reach: 0,
    Impressions: 454,
    Followers: 100,
  }),
  makeRecord({
    Platform: "Pinterest",
    Date: "2026-06-01",
    Reach: 0,
    Impressions: 5234,
    Followers: 50,
  }),
];

function platformCard(label: string): HTMLElement {
  const el = screen.getByText(label).closest(".rounded-xl");
  if (!el) throw new Error(`Platform card "${label}" not found`);
  return el as HTMLElement;
}

function rowValue(card: HTMLElement, rowLabel: string): string {
  const labelEl = within(card).getByText(rowLabel);
  const value = labelEl.parentElement?.querySelector("p.text-lg");
  return value?.textContent ?? "";
}

beforeEach(() => {
  lineCharts.length = 0;
});

describe("PlatformCard metric rows (WEBDEV-189)", () => {
  it("shows — instead of silent zeros for non-reported metrics", () => {
    render(<PlatformCompare posts={[]} dailyMetrics={fixtures} />);

    const fb = platformCard("Facebook");
    expect(rowValue(fb, "Reach")).toBe("—");
    expect(rowValue(fb, "Impressions")).toBe("454");

    const ig = platformCard("Instagram");
    expect(rowValue(ig, "Reach")).toBe("120");
    expect(rowValue(ig, "Impressions")).toBe("—");

    const pin = platformCard("Pinterest");
    expect(rowValue(pin, "Reach")).toBe("—");
    expect(rowValue(pin, "Impressions")).toBe("5.2K");
  });
});

describe("Distribution comparison charts (WEBDEV-189)", () => {
  it("drops never-reporting platforms from the Reach and Impressions charts", () => {
    render(<PlatformCompare posts={[]} dailyMetrics={fixtures} />);

    const allDatasetLabels = lineCharts.flatMap((c) =>
      c.datasets.map((d) => d.label),
    );
    // Reach chart: IG only — FB/Pinterest bogus zeros must not flatline
    expect(allDatasetLabels).toContain("Instagram Reach");
    expect(allDatasetLabels).not.toContain("Facebook Reach");
    expect(allDatasetLabels).not.toContain("Pinterest Reach");
    // Impressions chart: FB + Pinterest only — IG has no such metric
    expect(allDatasetLabels).toContain("Facebook Impressions");
    expect(allDatasetLabels).toContain("Pinterest Impressions");
    expect(allDatasetLabels).not.toContain("Instagram Impressions");
  });

  it("shows an empty-state message instead of a blank chart frame", () => {
    // IG-only view (e.g. platform filter): no platform reports impressions
    render(<PlatformCompare posts={[]} dailyMetrics={[fixtures[0]]} />);

    expect(
      screen.getByText(
        "No platform reports account impressions in the selected range.",
      ),
    ).toBeTruthy();
    const allDatasetLabels = lineCharts.flatMap((c) =>
      c.datasets.map((d) => d.label),
    );
    expect(allDatasetLabels).not.toContain("Instagram Impressions");
  });
});
