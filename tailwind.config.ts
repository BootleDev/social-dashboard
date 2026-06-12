import type { Config } from "tailwindcss";

/**
 * Semantic color tokens are backed by the CSS variables defined in
 * src/app/globals.css (light + .dark). Using these Tailwind classes
 * (text-success, bg-danger-soft, border-warning, etc.) keeps status colors
 * theme-aware — they invert automatically in light mode instead of being
 * frozen as text-green-400 / bg-red-500 literals.
 */
const config: Config = {
  content: [
    "./src/pages/**/*.{js,ts,jsx,tsx,mdx}",
    "./src/components/**/*.{js,ts,jsx,tsx,mdx}",
    "./src/app/**/*.{js,ts,jsx,tsx,mdx}",
  ],
  theme: {
    extend: {
      fontFamily: {
        sans: ["ABC Diatype", "system-ui", "-apple-system", "sans-serif"],
      },
      colors: {
        background: "var(--bg-primary)",
        foreground: "var(--text-primary)",
        brand: {
          DEFAULT: "var(--brand)",
          hover: "var(--brand-hover)",
          subtle: "var(--brand-subtle)",
          soft: "var(--brand-soft)",
        },
        success: {
          DEFAULT: "var(--success)",
          soft: "var(--success-soft)",
        },
        danger: {
          DEFAULT: "var(--danger)",
          soft: "var(--danger-soft)",
        },
        warning: {
          DEFAULT: "var(--warning)",
          soft: "var(--warning-soft)",
        },
        info: {
          DEFAULT: "var(--info)",
          soft: "var(--info-soft)",
        },
        surface: {
          DEFAULT: "var(--bg-card)",
          secondary: "var(--bg-secondary)",
        },
        muted: "var(--text-secondary)",
        hairline: "var(--border)",
      },
    },
  },
  plugins: [],
};
export default config;
