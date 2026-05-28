"use client";

import { useEffect, useState, useCallback } from "react";

export interface SubNavItem<K extends string> {
  key: K;
  label: string;
  /** Optional small badge text shown after the label, e.g. counts. */
  badge?: string;
}

interface SubNavProps<K extends string> {
  /**
   * Stable identifier for this sub-nav instance. Used as the localStorage key
   * suffix so each tab's sub-nav remembers its own last selection independently.
   */
  storageKey: string;
  items: ReadonlyArray<SubNavItem<K>>;
  /** First item in `items` is used as the default when nothing is persisted. */
  defaultKey?: K;
  value: K;
  onChange: (key: K) => void;
}

const STORAGE_PREFIX = "bootle_dashboard_subnav_";

/**
 * Pill-style sub-navigation row used inside Insights and Planning to avoid
 * deep scroll. One section visible at a time; selection persists per
 * parent-tab in localStorage so reloading lands on the user's last view.
 */
export default function SubNav<K extends string>({
  storageKey,
  items,
  value,
  onChange,
}: SubNavProps<K>) {
  return (
    <div
      className="flex flex-wrap gap-1 mb-4 pb-3"
      style={{ borderBottom: "1px solid var(--border)" }}
      role="tablist"
      aria-label={`${storageKey} sub-navigation`}
    >
      {items.map((item) => {
        const active = item.key === value;
        return (
          <button
            key={item.key}
            role="tab"
            aria-selected={active}
            onClick={() => onChange(item.key)}
            className="text-xs px-3 py-1.5 rounded-full cursor-pointer transition-colors"
            style={{
              background: active ? "var(--brand)" : "var(--bg-secondary)",
              color: active ? "#fff" : "var(--text-secondary)",
              border: "1px solid var(--border)",
            }}
          >
            {item.label}
            {item.badge && (
              <span
                className="ml-1.5 opacity-70"
                style={{ fontSize: "0.65rem" }}
              >
                {item.badge}
              </span>
            )}
          </button>
        );
      })}
    </div>
  );
}

/**
 * Hook that pairs with SubNav for persistent selection. Hydrates from
 * localStorage in useEffect to stay SSR-safe.
 */
export function useSubNav<K extends string>(
  storageKey: string,
  defaultKey: K,
  validKeys: ReadonlyArray<K>,
): [K, (k: K) => void] {
  const [value, setValueState] = useState<K>(defaultKey);

  useEffect(() => {
    try {
      const raw = window.localStorage.getItem(STORAGE_PREFIX + storageKey);
      if (raw && (validKeys as readonly string[]).includes(raw)) {
        setValueState(raw as K);
      }
    } catch {
      // localStorage unavailable; default already set.
    }
  }, [storageKey, validKeys]);

  const setValue = useCallback(
    (k: K) => {
      setValueState(k);
      try {
        window.localStorage.setItem(STORAGE_PREFIX + storageKey, k);
      } catch {
        // Persistence failure is non-critical.
      }
    },
    [storageKey],
  );

  return [value, setValue];
}
