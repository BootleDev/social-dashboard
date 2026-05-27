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

export const CHART_COLORS = {
  blue: "#3b82f6",
  green: "#22c55e",
  red: "#ef4444",
  amber: "#f59e0b",
  purple: "#a855f7",
  cyan: "#06b6d4",
  pink: "#ec4899",
  white: "#f0f0f5",
  muted: "#9ca3af",
  grid: "#2a2e3d",
};

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

export const defaultOptions = {
  responsive: true,
  maintainAspectRatio: false,
  // Default to point-mode so individual chart consumers don't have to
  // remember to override per-chart. Line/time-series charts use
  // `lineChartOptions` below to opt into LINE_INTERACTION explicitly.
  interaction: POINT_INTERACTION,
  plugins: {
    legend: {
      labels: { color: CHART_COLORS.muted, font: { size: 12 } },
    },
    tooltip: {
      backgroundColor: "#1e2230",
      titleColor: CHART_COLORS.white,
      bodyColor: CHART_COLORS.muted,
      borderColor: CHART_COLORS.grid,
      borderWidth: 1,
    },
  },
  scales: {
    x: {
      ticks: { color: CHART_COLORS.muted, font: { size: 12 } },
      grid: { color: "transparent" },
    },
    y: {
      ticks: { color: CHART_COLORS.muted, font: { size: 12 } },
      grid: { color: CHART_COLORS.grid },
    },
  },
};

/**
 * Default options preset for line/time-series charts. Uses index-mode so
 * mousing anywhere along the x-axis surfaces a tooltip with all series
 * values at that x. Bar/scatter consumers should use `defaultOptions`
 * (point-mode) for accurate click hit-detection.
 */
export const lineChartOptions = {
  ...defaultOptions,
  interaction: LINE_INTERACTION,
  plugins: {
    ...defaultOptions.plugins,
    tooltip: {
      ...defaultOptions.plugins.tooltip,
      mode: "index" as const,
      intersect: false,
    },
  },
};
