/**
 * countryRollup — cap a ranked country list at a top-N and fold the long tail
 * into a single "other" bucket (WEBDEV-182 item 13).
 *
 * The Instagram audience country list returned ~57 rows, each a thin slice;
 * past the top dozen they are noise that buries the meaningful concentration.
 * This collapses the tail into one labelled rollup so the reader sees the top
 * markets plus an honest "+ N more countries" line, with the tail's follower
 * total preserved.
 */

/** Minimal ranked-row shape (decoupled from the full demographic type). */
export interface CountryRow {
  bucket: string;
  value: number;
}

/** The folded tail: how many countries and how many followers it represents. */
export interface CountryOther {
  countryCount: number;
  value: number;
}

export interface CountryRollup {
  /** Top-N countries, descending by value. */
  shown: CountryRow[];
  /** The folded tail, or null when nothing was folded. */
  other: CountryOther | null;
}

/**
 * Keep the top `topN` countries by value and fold the rest into `other`.
 *
 * Folding only happens when at least TWO countries would be hidden — folding a
 * single tail country into "Other (1 country)" hides information without
 * saving space, so that one row is shown instead.
 */
export function rollupCountries(
  rows: CountryRow[],
  topN: number,
): CountryRollup {
  const ranked = [...rows].sort((a, b) => b.value - a.value);

  const tail = ranked.slice(topN);
  if (tail.length < 2) {
    // 0 or 1 in the tail → show everything; no meaningful rollup.
    return { shown: ranked, other: null };
  }

  return {
    shown: ranked.slice(0, topN),
    other: {
      countryCount: tail.length,
      value: tail.reduce((s, r) => s + r.value, 0),
    },
  };
}
