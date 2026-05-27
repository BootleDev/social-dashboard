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

export const defaultOptions = {
  responsive: true,
  maintainAspectRatio: false,
  // MARKETING-XX 2026-05-26: enable index-mode tooltips so users can mouse
  // anywhere along the x-axis to inspect values. Default chart.js requires
  // landing on a point exactly, which is unusable on dense line charts.
  interaction: {
    mode: "index" as const,
    intersect: false,
    axis: "x" as const,
  },
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
      // Match interaction mode so the tooltip itself shows all series at x.
      mode: "index" as const,
      intersect: false,
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
