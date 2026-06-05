/**
 * topPinRanking — ranking + metric access for the "Top performing pins" view.
 *
 * Most sort modes (Impressions / Saves / Outbound clicks) are pre-ranked
 * server-side: the Pinterest refresher fetches a separate top-pins set per
 * metric, tagged with `sortBy`, and the component just reads that set in rank
 * order. "Pin clicks" was never fetched as its own ranked set, so those rows
 * don't exist — but every fetched pin still carries its own `pinClick` value.
 * So Pin clicks is ranked CLIENT-SIDE here: dedupe the pins present in the
 * latest snapshot and re-rank them by pinClick. This surfaces the metric with
 * no pipeline change (WEBDEV-182 follow-up).
 */

import type { TopPin } from "./types";

/** Sort modes that arrive pre-ranked from the server (one fetch per metric). */
const SERVER_RANKED: ReadonlySet<TopPin["sortBy"]> = new Set([
  "IMPRESSION",
  "SAVE",
  "OUTBOUND_CLICK",
  "ENGAGEMENT",
]);

const TOP_N = 12;

/** The metric value for a pin under a given sort mode. */
export function metricValue(pin: TopPin, sortBy: TopPin["sortBy"]): number {
  switch (sortBy) {
    case "IMPRESSION":
      return pin.impressions;
    case "SAVE":
      return pin.saves;
    case "OUTBOUND_CLICK":
      return pin.outboundClick;
    case "PIN_CLICK":
      return pin.pinClick;
    case "ENGAGEMENT":
      return pin.engagement;
  }
}

/**
 * The ranked, top-N pins to display for `sortBy` in the latest snapshot.
 *
 * - Server-ranked modes: filter to the matching `sortBy` set and keep the
 *   server rank order.
 * - PIN_CLICK: dedupe by pin across all of the latest snapshot's sort sets,
 *   drop pins with zero clicks, re-rank by pinClick desc, and stamp synthetic
 *   1-based ranks so the card badges read sensibly.
 */
export function rankedPins(
  pins: TopPin[],
  latestDate: string,
  sortBy: TopPin["sortBy"],
): TopPin[] {
  const inLatest = pins.filter((p) => p.snapshotDate === latestDate);

  if (SERVER_RANKED.has(sortBy)) {
    return inLatest
      .filter((p) => p.sortBy === sortBy)
      .sort((a, b) => a.rank - b.rank)
      .slice(0, TOP_N);
  }

  // PIN_CLICK — client re-rank over unique pins.
  const byPin = new Map<string, TopPin>();
  for (const p of inLatest) {
    const existing = byPin.get(p.pinId);
    // Keep the row with the highest pinClick for this pin (they should agree,
    // but be defensive against per-set drift).
    if (!existing || p.pinClick > existing.pinClick) byPin.set(p.pinId, p);
  }

  return Array.from(byPin.values())
    .filter((p) => p.pinClick > 0)
    .sort((a, b) => b.pinClick - a.pinClick)
    .slice(0, TOP_N)
    .map((p, i) => ({ ...p, rank: i + 1 }));
}
