import { describe, it, expect, vi } from "vitest";
import { createTtlCache } from "../ttlCache";

describe("createTtlCache", () => {
  it("calls the loader on a cold miss and returns its value", async () => {
    let now = 1000;
    const cache = createTtlCache({ ttlMs: 100, clock: () => now });
    const loader = vi.fn().mockResolvedValue(["a"]);

    const result = await cache.get("k", loader);

    expect(result).toEqual(["a"]);
    expect(loader).toHaveBeenCalledTimes(1);
  });

  it("serves a warm hit without calling the loader again", async () => {
    let now = 1000;
    const cache = createTtlCache({ ttlMs: 100, clock: () => now });
    const loader = vi.fn().mockResolvedValue(["a"]);

    await cache.get("k", loader);
    now = 1050; // within TTL
    const second = await cache.get("k", loader);

    expect(second).toEqual(["a"]);
    expect(loader).toHaveBeenCalledTimes(1);
  });

  it("reloads after the TTL expires", async () => {
    let now = 1000;
    const cache = createTtlCache({ ttlMs: 100, clock: () => now });
    const loader = vi
      .fn()
      .mockResolvedValueOnce(["a"])
      .mockResolvedValueOnce(["b"]);

    await cache.get("k", loader);
    now = 1101; // just past TTL
    const second = await cache.get("k", loader);

    expect(second).toEqual(["b"]);
    expect(loader).toHaveBeenCalledTimes(2);
  });

  it("bypasses the cache and refreshes the entry when forceRefresh is set", async () => {
    let now = 1000;
    const cache = createTtlCache({ ttlMs: 10000, clock: () => now });
    const loader = vi
      .fn()
      .mockResolvedValueOnce(["a"])
      .mockResolvedValueOnce(["b"]);

    await cache.get("k", loader);
    // Within TTL, but forceRefresh must skip the warm value AND repopulate it.
    const forced = await cache.get("k", loader, { forceRefresh: true });
    expect(forced).toEqual(["b"]);
    expect(loader).toHaveBeenCalledTimes(2);

    // The forced refresh wrote through: a subsequent normal read is a hit on "b".
    now = 1001;
    const after = await cache.get("k", loader);
    expect(after).toEqual(["b"]);
    expect(loader).toHaveBeenCalledTimes(2);
  });

  it("keys entries independently", async () => {
    let now = 1000;
    const cache = createTtlCache({ ttlMs: 100, clock: () => now });
    const a = await cache.get("a", () => Promise.resolve(["A"]));
    const b = await cache.get("b", () => Promise.resolve(["B"]));
    expect(a).toEqual(["A"]);
    expect(b).toEqual(["B"]);
  });

  it("does not cache a rejected loader (failure is not memoized)", async () => {
    let now = 1000;
    const cache = createTtlCache({ ttlMs: 100, clock: () => now });
    const loader = vi
      .fn()
      .mockRejectedValueOnce(new Error("boom"))
      .mockResolvedValueOnce(["ok"]);

    await expect(cache.get("k", loader)).rejects.toThrow("boom");
    // Next call must retry (the error was not stored).
    const retry = await cache.get("k", loader);
    expect(retry).toEqual(["ok"]);
    expect(loader).toHaveBeenCalledTimes(2);
  });

  it("dedupes concurrent loads for the same key (single in-flight loader)", async () => {
    let now = 1000;
    const cache = createTtlCache({ ttlMs: 100, clock: () => now });
    let resolve!: (v: string[]) => void;
    const loader = vi.fn().mockReturnValue(
      new Promise<string[]>((r) => {
        resolve = r;
      }),
    );

    const p1 = cache.get("k", loader);
    const p2 = cache.get("k", loader);
    resolve(["x"]);
    const [r1, r2] = await Promise.all([p1, p2]);

    expect(r1).toEqual(["x"]);
    expect(r2).toEqual(["x"]);
    expect(loader).toHaveBeenCalledTimes(1);
  });
});
