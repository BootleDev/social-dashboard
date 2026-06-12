/**
 * feedFreshness — compute per-feed data freshness for the Ops → Pipeline Health
 * view (WEBDEV-182 item 14).
 *
 * The dashboard reads ~9 Airtable feeds, each refreshed on its own cadence by
 * the n8n Social Data Refresher. The Pipeline Health tab was an empty
 * placeholder; this turns it into a real status view: each feed's last measured
 * date, record count, and whether it is fresh / stale / empty against a
 * per-feed staleness window.
 *
 * The logic is pure and `today` is injected (not read from the clock) so it is
 * deterministic and unit-tested; the component supplies the real date.
 */

import { str } from "./utils";
import type { AirtableRecord } from "./utils";

export type FeedHealthStatus = "fresh" | "stale" | "empty" | "reference";

/** Declarative description of one feed and how to judge its freshness. */
export interface FeedSpec {
  /** Stable key into the data map. */
  key: string;
  /** Human label for the row. */
  label: string;
  /** ISO date field whose max value is the feed's freshness date. */
  dateField: string;
  /** Days behind `today` still considered fresh (inclusive). */
  maxAgeDays: number;
  /**
   * Reference/config tables (e.g. seasonal opportunities) have no time series
   * and are never "stale" — they report a record count only.
   */
  reference?: boolean;
  /** Optional one-line note about cadence shown under the row. */
  note?: string;
}

export interface FeedHealthRow {
  key: string;
  label: string;
  lastDate: string | null;
  recordCount: number;
  status: FeedHealthStatus;
  note?: string;
}

/** Most recent yyyy-mm-dd present in `field` across records, or null. */
export function latestDateInField(
  records: AirtableRecord[],
  field: string,
): string | null {
  let max: string | null = null;
  for (const r of records) {
    const raw = str(r.fields[field]).split("T")[0];
    if (!raw) continue;
    if (max === null || raw > max) max = raw;
  }
  return max;
}

/** Whole-day difference between two yyyy-mm-dd strings (a - b). */
function dayDiff(a: string, b: string): number {
  const da = Date.parse(`${a}T00:00:00Z`);
  const db = Date.parse(`${b}T00:00:00Z`);
  if (Number.isNaN(da) || Number.isNaN(db)) return Number.POSITIVE_INFINITY;
  return Math.round((da - db) / 86400000);
}

/**
 * Classify a feed by its last date vs `today`. Fresh when the last date is no
 * more than `maxAgeDays` behind today (inclusive); empty when there is no date.
 */
export function feedStatus(
  lastDate: string | null,
  today: string,
  maxAgeDays: number,
): Exclude<FeedHealthStatus, "reference"> {
  if (!lastDate) return "empty";
  const age = dayDiff(today, lastDate);
  return age <= maxAgeDays ? "fresh" : "stale";
}

/** Build a status row per spec from a map of feed-key → records. */
export function buildFeedHealth(
  specs: FeedSpec[],
  data: Record<string, AirtableRecord[]>,
  today: string,
): FeedHealthRow[] {
  return specs.map((spec) => {
    const records = data[spec.key] ?? [];
    const recordCount = records.length;

    if (spec.reference) {
      return {
        key: spec.key,
        label: spec.label,
        lastDate: null,
        recordCount,
        status: "reference" as const,
        note: spec.note,
      };
    }

    const lastDate = latestDateInField(records, spec.dateField);
    return {
      key: spec.key,
      label: spec.label,
      lastDate,
      recordCount,
      status: feedStatus(lastDate, today, spec.maxAgeDays),
      note: spec.note,
    };
  });
}
