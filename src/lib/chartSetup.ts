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
  plugins: {
    legend: {
      labels: { color: CHART_COLORS.muted, font: { size: 11 } },
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
      ticks: { color: CHART_COLORS.muted, font: { size: 10 } },
      grid: { color: "transparent" },
    },
    y: {
      ticks: { color: CHART_COLORS.muted, font: { size: 10 } },
      grid: { color: CHART_COLORS.grid },
    },
  },
};
