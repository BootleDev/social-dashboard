import { describe, it, expect } from "vitest";
import { rankedPins, metricValue } from "../topPinRanking";
import type { TopPin } from "../types";

function pin(over: Partial<TopPin>): TopPin {
  return {
    id: over.id ?? `r${Math.random()}`,
    pinId: over.pinId ?? "p1",
    postId: over.postId ?? "post1",
    snapshotDate: over.snapshotDate ?? "2026-06-05",
    sortBy: over.sortBy ?? "IMPRESSION",
    rank: over.rank ?? 1,
    impressions: over.impressions ?? 0,
    saves: over.saves ?? 0,
    outboundClick: over.outboundClick ?? 0,
    pinClick: over.pinClick ?? 0,
    engagement: over.engagement ?? 0,
    thumbnailUrl: over.thumbnailUrl ?? "",
  } as TopPin;
}

describe("rankedPins — native (server-ranked) modes", () => {
  it("keeps server rank order and filters to the matching sortBy + latest date", () => {
    const pins = [
      pin({ id: "a", sortBy: "SAVE", rank: 2, snapshotDate: "2026-06-05" }),
      pin({ id: "b", sortBy: "SAVE", rank: 1, snapshotDate: "2026-06-05" }),
      pin({ id: "c", sortBy: "IMPRESSION", rank: 1, snapshotDate: "2026-06-05" }),
      pin({ id: "d", sortBy: "SAVE", rank: 1, snapshotDate: "2026-06-04" }), // stale
    ];
    const out = rankedPins(pins, "2026-06-05", "SAVE");
    expect(out.map((p) => p.id)).toEqual(["b", "a"]);
  });
});

describe("rankedPins — PIN_CLICK (client re-ranked)", () => {
  it("dedupes pins across sort sets and re-ranks by pinClick desc", () => {
    // Same pin (pinId X) appears in two server sets; it must count once.
    const pins = [
      pin({ id: "x1", pinId: "X", sortBy: "IMPRESSION", pinClick: 9 }),
      pin({ id: "x2", pinId: "X", sortBy: "SAVE", pinClick: 9 }),
      pin({ id: "y1", pinId: "Y", sortBy: "IMPRESSION", pinClick: 3 }),
      pin({ id: "z1", pinId: "Z", sortBy: "SAVE", pinClick: 5 }),
    ];
    const out = rankedPins(pins, "2026-06-05", "PIN_CLICK");
    // X (9) once, then Z (5), then Y (3).
    expect(out.map((p) => p.pinId)).toEqual(["X", "Z", "Y"]);
  });

  it("ranks unique pins by pinClick descending with synthetic 1-based ranks", () => {
    const pins = [
      pin({ pinId: "A", pinClick: 2 }),
      pin({ pinId: "B", pinClick: 9 }),
      pin({ pinId: "C", pinClick: 5 }),
    ];
    const out = rankedPins(pins, "2026-06-05", "PIN_CLICK");
    expect(out.map((p) => p.pinId)).toEqual(["B", "C", "A"]);
    expect(out.map((p) => p.rank)).toEqual([1, 2, 3]);
  });

  it("excludes pins with zero pin clicks (no signal to rank)", () => {
    const pins = [
      pin({ pinId: "A", pinClick: 0 }),
      pin({ pinId: "B", pinClick: 4 }),
    ];
    const out = rankedPins(pins, "2026-06-05", "PIN_CLICK");
    expect(out.map((p) => p.pinId)).toEqual(["B"]);
  });

  it("only considers the latest snapshot", () => {
    const pins = [
      pin({ pinId: "OLD", pinClick: 99, snapshotDate: "2026-06-01" }),
      pin({ pinId: "NEW", pinClick: 1, snapshotDate: "2026-06-05" }),
    ];
    const out = rankedPins(pins, "2026-06-05", "PIN_CLICK");
    expect(out.map((p) => p.pinId)).toEqual(["NEW"]);
  });

  it("caps the result at 12", () => {
    const pins = Array.from({ length: 20 }, (_, i) =>
      pin({ pinId: `P${i}`, pinClick: i + 1 }),
    );
    const out = rankedPins(pins, "2026-06-05", "PIN_CLICK");
    expect(out).toHaveLength(12);
    expect(out[0].pinClick).toBe(20); // highest first
  });
});

describe("metricValue", () => {
  const p = pin({ impressions: 100, saves: 20, outboundClick: 7, pinClick: 4 });
  it("returns the metric matching the sort mode", () => {
    expect(metricValue(p, "IMPRESSION")).toBe(100);
    expect(metricValue(p, "SAVE")).toBe(20);
    expect(metricValue(p, "OUTBOUND_CLICK")).toBe(7);
    expect(metricValue(p, "PIN_CLICK")).toBe(4);
  });
});
