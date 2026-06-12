"use client";

import { useEffect, useState, useCallback } from "react";

const STORAGE_KEY = "bootle_dashboard_tz";

/**
 * React hook that exposes the current timezone selection (IANA string or
 * empty for browser-local) and a setter that persists to localStorage.
 *
 * Components that need to render localized timestamps call this and pass the
 * timezone string to the utils helpers (formatLocalDate, hourOfDayLocal, …).
 */
export function useTimezone(): [string, (tz: string) => void] {
  // Hydrate from localStorage once on mount. We can't read localStorage on
  // initial render in SSR-safe code, so default to empty (browser-local)
  // then update in useEffect.
  const [timezone, setTimezoneState] = useState<string>("");

  useEffect(() => {
    try {
      const saved = window.localStorage.getItem(STORAGE_KEY);
      if (saved !== null) setTimezoneState(saved);
    } catch {
      // localStorage unavailable (e.g. SSR, private browsing) — silently
      // fall back to browser-local.
    }
  }, []);

  const setTimezone = useCallback((tz: string) => {
    setTimezoneState(tz);
    try {
      window.localStorage.setItem(STORAGE_KEY, tz);
    } catch {
      // Persistence failure is non-critical; the setting still applies for
      // the current session.
    }
  }, []);

  return [timezone, setTimezone];
}
