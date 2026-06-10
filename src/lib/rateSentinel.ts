/**
 * Runtime unit-scale sentinel for the Supabase read path (WEBDEV-210; ported
 * from ad-dashboard).
 *
 * WHY THIS EXISTS: the dashboard renders Engagement Rate as
 * `num(fields['Engagement Rate']) * 100` and plots it on the SAME axis as the
 * Airtable POSTS-derived ER line, so the stored value MUST be a fraction
 * (0.0870 = 8.70%) — the exact 100x bug class the WEBDEV-207 review flagged
 * as its #1 risk. Today the invariant is enforced upstream by Airtable's
 * `percent` field type (the dual-write would visibly break in Airtable if
 * the writer switched to percents) and locked at the mapper layer by
 * supabaseMappers.test.ts — but the mapper tests run on FIXTURES, so nothing
 * at runtime notices if the upstream writer ever starts storing percent-scale
 * values in Postgres. Once the WEBDEV-191 ETL rewrite retires the Airtable
 * dual-write, this sentinel is the ONLY thing standing between writer drift
 * and the ER trend rendering 100x too large.
 *
 * Mechanism: scan the raw pg rows inside the Supabase getter, BEFORE the
 * mapped envelope is returned. A violation on a throwOn column throws, which
 * lands in the caller's existing catch in airtable.ts and FAILS OVER to the
 * Airtable read — a loud, correct degradation instead of silently-wrong
 * charts. (After dual-write retirement that failover serves stale-but-
 * correctly-scaled data, with the error in the Vercel logs — still the right
 * trade.)
 *
 * Column policy: engagement_rate is throwOn — an ACCOUNT-level daily ER
 * (engagements relative to followers/reach per er_type) above 100% is not a
 * real value (live data 2026-06: max 0.25 across 361 rows), while
 * percent-scale drift lands at 2–15. NEGATIVE values also throw — a rate
 * outside [0, 1] is corrupt whatever the cause. Counts (followers,
 * impressions, reach, ...) are never listed.
 *
 * LIMITATION (by design): a tripwire, not a proof. Percent-scale drift on a
 * metric whose real value is under 1% stays under the threshold; the
 * ad-dashboard repo's scheduled parity run covers the marketing tables, and
 * Airtable's percent field type remains the social-side forcing function
 * until dual-write retirement. Pure module (no I/O) so vitest exercises it
 * directly.
 */

type Row = Record<string, unknown>;

export interface RateSentinelCols {
  /** Columns whose value outside [0, 1] throws (fails the Supabase read over to Airtable). */
  throwOn: readonly string[];
  /** Columns whose value outside [0, 1] only logs a console.warn. */
  warnOn?: readonly string[];
  /**
   * Columns concatenated with "|" to identify the first offending row in
   * messages (e.g. ["platform", "date"] — daily_account_metrics has one row
   * per platform per day, so no single column is unique).
   */
  idCols?: readonly string[];
}

/** Number(v) for numbers and pg numeric strings; NaN for everything else. */
function asNumber(v: unknown): number {
  if (typeof v === "number") return v;
  if (typeof v === "string" && v.trim() !== "") return Number(v);
  return NaN;
}

interface ColumnViolation {
  column: string;
  count: number;
  max: number;
  exampleId: string;
  exampleValue: unknown;
}

function rowId(
  row: Row,
  index: number,
  idCols: readonly string[] | undefined,
): string {
  if (!idCols || idCols.length === 0) return `row ${index}`;
  const parts = idCols.map((c) =>
    row[c] === null || row[c] === undefined ? "?" : String(row[c]),
  );
  // All id columns empty -> fall back to the row index.
  return parts.every((p) => p === "?") ? `row ${index}` : parts.join("|");
}

function scanColumn(
  rows: Row[],
  column: string,
  idCols: readonly string[] | undefined,
): ColumnViolation | null {
  let count = 0;
  let max = -Infinity;
  let exampleId = "";
  let exampleValue: unknown;
  for (let i = 0; i < rows.length; i++) {
    const v = rows[i][column];
    // null/undefined = sparse cell, skip. Non-numeric junk is a SHAPE
    // problem, not a scale problem — the mapper tests own that class; the
    // sentinel stays narrowly about magnitude.
    if (v === null || v === undefined) continue;
    const n = asNumber(v);
    if (!Number.isFinite(n)) continue;
    // A fraction-scale rate lives in [0, 1]: > 1 is the percent-drift
    // signature, < 0 is corrupt whatever the cause.
    if (n > 1 || n < 0) {
      count++;
      if (n > max) max = n;
      if (count === 1) {
        exampleId = rowId(rows[i], i, idCols);
        exampleValue = v;
      }
    }
  }
  return count > 0
    ? { column, count, max, exampleId, exampleValue }
    : null;
}

/**
 * Assert that the listed rate columns are fraction-scale (within [0, 1])
 * across all rows. Throws on any throwOn violation; console.warns on warnOn
 * violations. Values of exactly 0 or 1 (true 0% / 100% rates) pass.
 */
export function assertFractionScale(
  source: string,
  rows: Row[],
  cols: RateSentinelCols,
): void {
  for (const column of cols.warnOn ?? []) {
    const v = scanColumn(rows, column, cols.idCols);
    if (v) {
      console.warn(
        `[unit-sentinel] ${source}: ${v.column} outside [0, 1] in ${v.count}/${rows.length} rows ` +
          `(max ${v.max}, e.g. ${v.exampleId} = ${JSON.stringify(v.exampleValue)}) — ` +
          `tolerated (this rate can legitimately exceed 1), but if a throwOn ` +
          `metric also trips, suspect percent-scale writer drift.`,
      );
    }
  }

  const violations = cols.throwOn
    .map((column) => scanColumn(rows, column, cols.idCols))
    .filter((v): v is ColumnViolation => v !== null);

  if (violations.length > 0) {
    const detail = violations
      .map(
        (v) =>
          `${v.column} outside [0, 1] in ${v.count}/${rows.length} rows ` +
          `(max ${v.max}, e.g. ${v.exampleId} = ${JSON.stringify(v.exampleValue)})`,
      )
      .join("; ");
    throw new Error(
      `[unit-sentinel] ${source}: ${detail}. Rate columns must be FRACTIONS ` +
        `in [0, 1] (0.0870 = 8.70%) — values above 1 mean the upstream writer ` +
        `drifted to percent scale (rendered 100x too large by the dashboard); ` +
        `negative values are corrupt either way. Failing this read so the ` +
        `caller falls back to Airtable.`,
    );
  }
}
