import {
  Chart as ChartJS,
  CategoryScale,
  LinearScale,
  PointElement,
  LineElement,
  BarElement,
  ArcElement,
  Filler,
  Tooltip,
  Legend,
} from "chart.js";

ChartJS.register(
  CategoryScale,
  LinearScale,
  PointElement,
  LineElement,
  BarElement,
  ArcElement,
  Filler,
  Tooltip,
  Legend,
);

/**
 * Theme-aware chart colours.
 *
 * Chart.js bakes colours into its options object, so to follow a light/dark
 * theme switch we must resolve the current CSS-variable values at render time
 * rather than freezing hex at module load. `resolveChartColors()` reads the
 * computed `--chart-*` variables off <html>; `useChartTheme()` (in
 * useChartTheme.ts) re-runs it whenever next-themes flips the theme.
 *
 * Semantics:
 *  - grid / axis / tooltip*   -> chrome that must invert with the theme
 *  - brand + status (success/warning/danger/info) -> meaning-carrying series
 *  - series[]                 -> blue-anchored ramp for NON-platform data;
 *    platform-keyed series should use platforms.ts colours instead.
 */
export interface ChartColors {
  grid: string;
  axis: string;
  tooltipBg: string;
  tooltipText: string;
  tooltipMuted: string;
  brand: string;
  success: string;
  warning: string;
  danger: string;
  info: string;
  /** Blue-anchored sequential ramp for non-platform categorical series. */
  series: string[];
}

function readVar(styles: CSSStyleDeclaration, name: string, fallback: string) {
  const v = styles.getPropertyValue(name).trim();
  return v || fallback;
}

/**
 * Fallbacks match the dark theme in globals.css so server-side / pre-mount
 * renders (where getComputedStyle is unavailable) don't draw with wrong-looking
 * colours. On the client, `useChartTheme()` recomputes after mount.
 */
const DARK_FALLBACK: ChartColors = {
  grid: "#34373d",
  axis: "#98a1b2",
  tooltipBg: "#25272b",
  tooltipText: "#f6f6f8",
  tooltipMuted: "#98a1b2",
  brand: "#529df6",
  success: "#34d27b",
  warning: "#e0a02b",
  danger: "#e5556b",
  info: "#529df6",
  series: ["#529df6", "#0171e4", "#95a5dc", "#34d27b", "#e0a02b", "#e5556b"],
};

export function resolveChartColors(): ChartColors {
  if (typeof window === "undefined" || typeof document === "undefined") {
    return DARK_FALLBACK;
  }
  const s = getComputedStyle(document.documentElement);
  return {
    grid: readVar(s, "--chart-grid", DARK_FALLBACK.grid),
    axis: readVar(s, "--chart-axis", DARK_FALLBACK.axis),
    tooltipBg: readVar(s, "--chart-tooltip-bg", DARK_FALLBACK.tooltipBg),
    tooltipText: readVar(s, "--chart-tooltip-text", DARK_FALLBACK.tooltipText),
    tooltipMuted: readVar(
      s,
      "--chart-tooltip-muted",
      DARK_FALLBACK.tooltipMuted,
    ),
    brand: readVar(s, "--brand", DARK_FALLBACK.brand),
    success: readVar(s, "--success", DARK_FALLBACK.success),
    warning: readVar(s, "--warning", DARK_FALLBACK.warning),
    danger: readVar(s, "--danger", DARK_FALLBACK.danger),
    info: readVar(s, "--info", DARK_FALLBACK.info),
    series: [
      readVar(s, "--chart-1", DARK_FALLBACK.series[0]),
      readVar(s, "--chart-2", DARK_FALLBACK.series[1]),
      readVar(s, "--chart-3", DARK_FALLBACK.series[2]),
      readVar(s, "--chart-4", DARK_FALLBACK.series[3]),
      readVar(s, "--chart-5", DARK_FALLBACK.series[4]),
      readVar(s, "--chart-6", DARK_FALLBACK.series[5]),
    ],
  };
}

// Interaction preset for line/time-series charts where users want to mouse
// anywhere along x and get a tooltip showing all series at that x. NOT
// suitable for bar/scatter — those need point-mode hit detection or clicks
// will silently fire on the wrong element.
export const LINE_INTERACTION = {
  mode: "index" as const,
  intersect: false,
  axis: "x" as const,
};

// Interaction preset for clickable bar / scatter / heatmap charts.
// `nearest` + `intersect: true` means the click only fires when the cursor
// is actually inside a bar/point — no more dead hitboxes or off-target
// drilldowns on horizontal bar charts where the default axis=x was wrong
// for the orientation.
export const POINT_INTERACTION = {
  mode: "nearest" as const,
  intersect: true,
};

/**
 * Build the base chart options for a given resolved palette. A function (not a
 * frozen constant) so the grid/axis/tooltip colours track the active theme.
 * Consumers spread it and override per-chart, exactly as before.
 */
export function buildDefaultOptions(c: ChartColors) {
  return {
    responsive: true,
    maintainAspectRatio: false,
    interaction: POINT_INTERACTION,
    plugins: {
      legend: {
        labels: { color: c.axis, font: { size: 12 } },
      },
      tooltip: {
        backgroundColor: c.tooltipBg,
        titleColor: c.tooltipText,
        bodyColor: c.tooltipMuted,
        borderColor: c.grid,
        borderWidth: 1,
      },
    },
    scales: {
      x: {
        ticks: { color: c.axis, font: { size: 12 } },
        grid: { color: "transparent" },
      },
      y: {
        ticks: { color: c.axis, font: { size: 12 } },
        grid: { color: c.grid },
      },
    },
  };
}

export type DefaultChartOptions = ReturnType<typeof buildDefaultOptions>;

/**
 * Line/time-series preset: index-mode interaction so mousing anywhere along x
 * surfaces a tooltip with all series at that x.
 */
export function buildLineChartOptions(c: ChartColors) {
  const base = buildDefaultOptions(c);
  return {
    ...base,
    interaction: LINE_INTERACTION,
    plugins: {
      ...base.plugins,
      tooltip: {
        ...base.plugins.tooltip,
        mode: "index" as const,
        intersect: false,
      },
    },
  };
}
