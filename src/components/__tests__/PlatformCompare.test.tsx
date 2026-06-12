import { describe, it, expect, vi } from "vitest";
import { render, screen, within } from "@testing-library/react";
import PlatformCompare from "../PlatformCompare";
import type { AirtableRecord } from "@/lib/utils";

// Charts need a real canvas; the KPI-row behavior under test doesn't.
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

// Account Daily Facts shapes (WEBDEV-146): per-metric Source columns are
// authoritative. IG reports per-day Reach but no per-day Impressions;
// FB/Pinterest report Impressions but no deduplicated account Reach.
const fixtures = [
  makeRecord({
    Platform: "Instagram",
    Date: "2026-06-01",
    Reach: 120,
    "Reach Source": "daily_real",
    "Impressions Source": "null",
    Followers: 600,
  }),
  makeRecord({
    Platform: "Facebook",
    Date: "2026-06-01",
    Impressions: 454,
    "Reach Source": "null",
    "Impressions Source": "daily_real",
    Followers: 100,
  }),
  makeRecord({
    Platform: "Pinterest",
    Date: "2026-06-01",
    Impressions: 5234,
    "Reach Source": "null",
    "Impressions Source": "daily_real",
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

describe("PlatformCard metric rows (structural nulls, WEBDEV-182/189)", () => {
  it("shows — instead of silent zeros for non-reported account metrics", () => {
    render(<PlatformCompare posts={[]} dailyMetrics={fixtures} />);

    const fb = platformCard("Facebook");
    expect(rowValue(fb, "Total Reach")).toBe("—");
    expect(rowValue(fb, "Impressions")).toBe("454");

    const ig = platformCard("Instagram");
    expect(rowValue(ig, "Total Reach")).toBe("120");
    expect(rowValue(ig, "Impressions")).toBe("—");

    const pin = platformCard("Pinterest");
    expect(rowValue(pin, "Total Reach")).toBe("—");
    expect(rowValue(pin, "Impressions")).toBe("5.2K");
  });

  it("never renders a structural blank as a real 0", () => {
    render(<PlatformCompare posts={[]} dailyMetrics={fixtures} />);
    const fb = platformCard("Facebook");
    expect(rowValue(fb, "Total Reach")).not.toBe("0");
    const ig = platformCard("Instagram");
    expect(rowValue(ig, "Impressions")).not.toBe("0");
  });
});
