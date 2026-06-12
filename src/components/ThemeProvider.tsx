"use client";

import { ThemeProvider as NextThemesProvider } from "next-themes";
import type { ReactNode } from "react";

/**
 * App-wide theme provider. Toggles a `.dark` class on <html> (attribute="class")
 * so the CSS-variable themes in globals.css switch wholesale. next-themes injects
 * a blocking inline script before paint, so there is no flash of the wrong theme
 * on initial load. Default follows the OS via `defaultTheme="system"`.
 */
export default function ThemeProvider({ children }: { children: ReactNode }) {
  return (
    <NextThemesProvider
      attribute="class"
      defaultTheme="system"
      enableSystem
      disableTransitionOnChange
    >
      {children}
    </NextThemesProvider>
  );
}
