"use client";

import { useCallback, useEffect, useState } from "react";

const PREFIX = "bootle_dashboard_persist_";

/**
 * useState that persists to localStorage under a stable key, SSR-safe.
 *
 * The initial render always uses `initial` (so server and first client render
 * match — no hydration mismatch); the persisted value is hydrated in an effect
 * after mount. Writes are JSON-serialized; a corrupt/absent entry falls back to
 * `initial`. localStorage failures (private mode, quota) are swallowed — the
 * state still works in-memory, it just won't persist.
 *
 * Mirrors the pattern in SubNav.useSubNav, generalized to any JSON value.
 */
export function usePersistedState<T>(
  key: string,
  initial: T,
): [T, (value: T) => void] {
  const [value, setValueState] = useState<T>(initial);

  useEffect(() => {
    try {
      const raw = window.localStorage.getItem(PREFIX + key);
      if (raw !== null) setValueState(JSON.parse(raw) as T);
    } catch {
      // No storage / parse error — keep the initial value.
    }
  }, [key]);

  const setValue = useCallback(
    (next: T) => {
      setValueState(next);
      try {
        window.localStorage.setItem(PREFIX + key, JSON.stringify(next));
      } catch {
        // Persistence is best-effort; ignore failures.
      }
    },
    [key],
  );

  return [value, setValue];
}
