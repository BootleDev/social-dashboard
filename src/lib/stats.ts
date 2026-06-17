/**
 * Lightweight descriptive-stats primitives for chart insight strips.
 *
 * All functions accept an array of finite numbers and return undefined when
 * input is empty (rather than NaN), so callers can render `—` cleanly.
 *
 * Outlier detection uses the standard 1.5 × IQR rule on quartiles computed
 * via linear interpolation (numpy / Excel "type 7" default).
 */

export interface DescriptiveStats {
  /** Sample size after filtering out non-finite values. */
  n: number;
  mean: number;
  median: number;
  p25: number;
  p75: number;
  /** Population standard deviation (divide by n, not n-1). */
  stdev: number;
  min: number;
  max: number;
  /** Interquartile range = p75 - p25. */
  iqr: number;
}

/**
 * Drop NaN / Infinity / null / undefined so a single bad value can't
 * corrupt a downstream median or stdev.
 */
function clean(values: ReadonlyArray<number | undefined | null>): number[] {
  const out: number[] = [];
  for (const v of values) {
    if (typeof v === "number" && Number.isFinite(v)) out.push(v);
  }
  return out;
}

/**
 * Quantile via linear interpolation between the two surrounding order statistics.
 * Matches numpy.quantile default (method="linear") and Excel PERCENTILE.
 */
export function quantile(sorted: ReadonlyArray<number>, q: number): number {
  if (sorted.length === 0) return NaN;
  if (sorted.length === 1) return sorted[0];
  const pos = (sorted.length - 1) * q;
  const lo = Math.floor(pos);
  const hi = Math.ceil(pos);
  if (lo === hi) return sorted[lo];
  const frac = pos - lo;
  return sorted[lo] * (1 - frac) + sorted[hi] * frac;
}

export function describe(
  values: ReadonlyArray<number | undefined | null>,
): DescriptiveStats | undefined {
  const cleaned = clean(values);
  if (cleaned.length === 0) return undefined;
  const sorted = [...cleaned].sort((a, b) => a - b);
  const n = sorted.length;
  const mean = sorted.reduce((sum, v) => sum + v, 0) / n;
  const variance =
    sorted.reduce((sum, v) => sum + (v - mean) ** 2, 0) / n;
  const p25 = quantile(sorted, 0.25);
  const p75 = quantile(sorted, 0.75);
  return {
    n,
    mean,
    median: quantile(sorted, 0.5),
    p25,
    p75,
    stdev: Math.sqrt(variance),
    min: sorted[0],
    max: sorted[n - 1],
    iqr: p75 - p25,
  };
}

/**
 * Identify outliers under the 1.5 × IQR rule. Returns the index of each
 * value in the original array that falls outside [p25 - 1.5*iqr, p75 + 1.5*iqr].
 * Returns empty array for n<4 (IQR is meaningless on tiny samples).
 */
export function outlierIndices(
  values: ReadonlyArray<number | undefined | null>,
): number[] {
  const stats = describe(values);
  if (!stats || stats.n < 4) return [];
  const low = stats.p25 - 1.5 * stats.iqr;
  const high = stats.p75 + 1.5 * stats.iqr;
  const out: number[] = [];
  values.forEach((v, i) => {
    if (typeof v === "number" && Number.isFinite(v) && (v < low || v > high)) {
      out.push(i);
    }
  });
  return out;
}

/**
 * Pearson correlation coefficient r ∈ [-1, 1].
 * Returns undefined when either series has zero variance or n<2.
 */
export function pearson(
  xs: ReadonlyArray<number | undefined | null>,
  ys: ReadonlyArray<number | undefined | null>,
): number | undefined {
  if (xs.length !== ys.length) return undefined;
  const xClean: number[] = [];
  const yClean: number[] = [];
  for (let i = 0; i < xs.length; i++) {
    const x = xs[i];
    const y = ys[i];
    if (
      typeof x === "number" &&
      typeof y === "number" &&
      Number.isFinite(x) &&
      Number.isFinite(y)
    ) {
      xClean.push(x);
      yClean.push(y);
    }
  }
  if (xClean.length < 2) return undefined;
  const n = xClean.length;
  const meanX = xClean.reduce((s, v) => s + v, 0) / n;
  const meanY = yClean.reduce((s, v) => s + v, 0) / n;
  let num = 0;
  let denomX = 0;
  let denomY = 0;
  for (let i = 0; i < n; i++) {
    const dx = xClean[i] - meanX;
    const dy = yClean[i] - meanY;
    num += dx * dy;
    denomX += dx * dx;
    denomY += dy * dy;
  }
  if (denomX === 0 || denomY === 0) return undefined;
  return num / Math.sqrt(denomX * denomY);
}

export interface ProportionInterval {
  /** Point estimate successes / trials. */
  p: number;
  low: number;
  high: number;
}

/**
 * Wilson score confidence interval for a binomial proportion (successes /
 * trials). Far more honest than the naive normal interval for small samples or
 * extreme proportions (e.g. 5 conversions on 2624 clicks), and it never escapes
 * [0, 1]. `z` defaults to 1.96 (95%). Returns undefined for non-positive or
 * non-finite trials, or when successes is out of [0, trials].
 *
 * This is what makes a CVR built on a handful of conversions honest: the point
 * estimate alone hides that the true rate could be meaningfully higher or lower.
 */
export function wilsonInterval(
  successes: number,
  trials: number,
  z = 1.96,
): ProportionInterval | undefined {
  if (!Number.isFinite(successes) || !Number.isFinite(trials)) return undefined;
  if (trials <= 0 || successes < 0 || successes > trials) return undefined;
  const p = successes / trials;
  const z2 = z * z;
  const denom = 1 + z2 / trials;
  const centre = p + z2 / (2 * trials);
  const margin = z * Math.sqrt((p * (1 - p)) / trials + z2 / (4 * trials * trials));
  return {
    p,
    low: Math.max(0, (centre - margin) / denom),
    high: Math.min(1, (centre + margin) / denom),
  };
}

/**
 * Percent change with explicit handling for the zero-baseline trap.
 * Returns undefined when `from` is 0 (Δ% is not defined), so callers can
 * render "new" or "—" rather than Infinity.
 */
export function pctChange(from: number, to: number): number | undefined {
  if (!Number.isFinite(from) || !Number.isFinite(to)) return undefined;
  if (from === 0) return undefined;
  return ((to - from) / Math.abs(from)) * 100;
}

/**
 * Format a percent-change number as a signed string with one decimal.
 * Renders "—" for undefined, "+0.0%" for exact zero.
 */
export function formatPct(delta: number | undefined, digits = 1): string {
  if (delta === undefined || !Number.isFinite(delta)) return "—";
  const sign = delta > 0 ? "+" : delta < 0 ? "" : "+";
  return `${sign}${delta.toFixed(digits)}%`;
}

/**
 * Categorise a percent change into a verdict. Defaults chosen to read
 * "accelerating" only on clearly positive moves, "decelerating" only on
 * clearly negative ones — flat covers small noise.
 */
export function trendVerdict(
  deltaPct: number | undefined,
  threshold = 5,
): "accelerating" | "flat" | "decelerating" {
  if (deltaPct === undefined) return "flat";
  if (deltaPct >= threshold) return "accelerating";
  if (deltaPct <= -threshold) return "decelerating";
  return "flat";
}
