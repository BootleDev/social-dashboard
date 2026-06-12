"use client";

import { useMemo } from "react";
import { useTheme } from "next-themes";
import {
  resolveChartColors,
  buildDefaultOptions,
  buildLineChartOptions,
  type ChartColors,
  type DefaultChartOptions,
} from "./chartSetup";

export interface ChartTheme {
  colors: ChartColors;
  defaultOptions: DefaultChartOptions;
  lineChartOptions: ReturnType<typeof buildLineChartOptions>;
}

/**
 * Returns chart colours + base options resolved from the current theme's CSS
 * variables. Recomputes whenever next-themes' `resolvedTheme` changes (light
 * <-> dark), so every chart that calls this re-renders with the correct grid /
 * axis / tooltip / series colours on a theme switch.
 *
 * Usage in a chart component:
 *   const { colors, defaultOptions, lineChartOptions } = useChartTheme();
 * then use `colors.series[i]`, `colors.brand`, etc. instead of the old
 * `CHART_COLORS.*`, and spread `defaultOptions` / `lineChartOptions` as before.
 */
export function useChartTheme(): ChartTheme {
  const { resolvedTheme } = useTheme();

  return useMemo(() => {
    const colors = resolveChartColors();
    return {
      colors,
      defaultOptions: buildDefaultOptions(colors),
      lineChartOptions: buildLineChartOptions(colors),
    };
    // resolvedTheme drives recomputation. resolveChartColors() reads the live
    // computed styles, which are correct by the time this memo re-runs because
    // next-themes has already swapped the .dark class on <html>.
  }, [resolvedTheme]);
}
