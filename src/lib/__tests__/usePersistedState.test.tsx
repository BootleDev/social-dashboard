import { describe, it, expect, beforeEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { usePersistedState } from "../usePersistedState";

const KEY = "bootle_dashboard_persist_test_key";

describe("usePersistedState", () => {
  beforeEach(() => window.localStorage.clear());

  it("uses the initial value when nothing is persisted", () => {
    const { result } = renderHook(() => usePersistedState("test_key", 42));
    expect(result.current[0]).toBe(42);
  });

  it("persists writes to localStorage (JSON-serialized)", () => {
    const { result } = renderHook(() => usePersistedState("test_key", 42));
    act(() => result.current[1](99));
    expect(result.current[0]).toBe(99);
    expect(window.localStorage.getItem(KEY)).toBe("99");
  });

  it("hydrates a persisted value on mount", () => {
    window.localStorage.setItem(KEY, JSON.stringify("hello"));
    const { result } = renderHook(() => usePersistedState("test_key", "default"));
    expect(result.current[0]).toBe("hello");
  });

  it("falls back to initial on a corrupt entry", () => {
    window.localStorage.setItem(KEY, "{not json");
    const { result } = renderHook(() => usePersistedState("test_key", "safe"));
    expect(result.current[0]).toBe("safe");
  });

  it("round-trips a string (empty-string override survives)", () => {
    const { result } = renderHook(() => usePersistedState("test_key", "x"));
    act(() => result.current[1](""));
    const second = renderHook(() => usePersistedState("test_key", "x"));
    expect(second.result.current[0]).toBe("");
  });
});
