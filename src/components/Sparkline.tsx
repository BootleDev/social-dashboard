"use client";

import { useId } from "react";

interface SparklineProps {
  /** Ordered series, oldest first. Nulls are gaps (skipped, line spans them). */
  data: ReadonlyArray<number | null>;
  /** Stroke colour. Defaults to currentColor so it inherits the delta colour. */
  color?: string;
  width?: number;
  height?: number;
  /** Soft area fill under the line. Off by default to keep the strip restrained. */
  fill?: boolean;
  className?: string;
}

/**
 * Minimal inline SVG sparkline for the north-star strip. No axes, no Chart.js —
 * a single path normalised into the box. Flat/empty series render as a faint
 * baseline rather than a crash, so a metric with no daily series still draws
 * something honest (a flat line) instead of an error state.
 *
 * The viewBox is fixed; the rendered size is set by width/height props, so the
 * same path math works at any display size and stays crisp (vector).
 */
export default function Sparkline({
  data,
  color = "currentColor",
  width = 96,
  height = 28,
  fill = false,
  className,
}: SparklineProps) {
  const gradientId = useId();
  // Keep a 2px inset so the stroke isn't clipped at the top/bottom edges.
  const PAD = 2;
  const VB_W = 100;
  const VB_H = 32;

  const points = data
    .map((v, i) => ({ v, i }))
    .filter((p): p is { v: number; i: number } => p.v !== null);

  // Fewer than two real points can't draw a trend — show a centred baseline.
  if (points.length < 2) {
    return (
      <svg
        width={width}
        height={height}
        viewBox={`0 0 ${VB_W} ${VB_H}`}
        className={className}
        preserveAspectRatio="none"
        aria-hidden="true"
      >
        <line
          x1={0}
          y1={VB_H / 2}
          x2={VB_W}
          y2={VB_H / 2}
          stroke={color}
          strokeWidth={1.5}
          strokeOpacity={0.35}
          vectorEffect="non-scaling-stroke"
        />
      </svg>
    );
  }

  const values = points.map((p) => p.v);
  const min = Math.min(...values);
  const max = Math.max(...values);
  const span = max - min || 1; // avoid divide-by-zero on a flat series

  // x is spaced by the ORIGINAL index so gaps keep their horizontal position.
  const lastIndex = data.length - 1 || 1;
  const toX = (i: number) => (i / lastIndex) * VB_W;
  const toY = (v: number) =>
    PAD + (1 - (v - min) / span) * (VB_H - PAD * 2);

  const coords = points.map((p) => [toX(p.i), toY(p.v)] as const);
  const linePath = coords
    .map(([x, y], idx) => `${idx === 0 ? "M" : "L"}${x.toFixed(2)},${y.toFixed(2)}`)
    .join(" ");

  const [firstX] = coords[0];
  const [lastX] = coords[coords.length - 1];
  const areaPath = `${linePath} L${lastX.toFixed(2)},${VB_H} L${firstX.toFixed(
    2,
  )},${VB_H} Z`;

  return (
    <svg
      width={width}
      height={height}
      viewBox={`0 0 ${VB_W} ${VB_H}`}
      className={className}
      preserveAspectRatio="none"
      aria-hidden="true"
    >
      {fill && (
        <>
          <defs>
            <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={color} stopOpacity={0.18} />
              <stop offset="100%" stopColor={color} stopOpacity={0} />
            </linearGradient>
          </defs>
          <path d={areaPath} fill={`url(#${gradientId})`} stroke="none" />
        </>
      )}
      <path
        d={linePath}
        fill="none"
        stroke={color}
        strokeWidth={1.75}
        strokeLinecap="round"
        strokeLinejoin="round"
        vectorEffect="non-scaling-stroke"
      />
    </svg>
  );
}
