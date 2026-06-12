/**
 * ttlCache — a tiny in-process TTL cache for already-parsed values.
 *
 * Why this exists (WEBDEV-182 follow-up): the dashboard's Airtable reads used
 * Next.js's per-fetch Data Cache (`next: { revalidate }`). Next caps a single
 * cached fetch entry at 2 MB, and the Pinterest-trends / Instagram-audience
 * feeds now exceed that, so the cached path threw and the dashboard 500'd on a
 * normal load (only the no-store Refresh path worked). Caching the PARSED
 * result here instead of the raw HTTP response sidesteps the 2 MB cap while
 * preserving the 30-minute cache window and the Refresh bypass.
 *
 * Scope: per-process, in-memory. Good enough for a single long-lived server
 * process; it is not a shared/distributed cache. The clock is injectable so the
 * expiry logic is deterministically testable.
 */

export interface TtlCacheOptions {
  /** Entry lifetime in milliseconds. */
  ttlMs: number;
  /** Time source (ms). Injectable for tests; defaults to Date.now. */
  clock?: () => number;
}

export interface TtlGetOptions {
  /** Skip any warm value, run the loader, and write the result through. */
  forceRefresh?: boolean;
}

interface Entry<T> {
  value: T;
  expiresAt: number;
}

export interface TtlCache {
  get<T>(
    key: string,
    loader: () => Promise<T>,
    opts?: TtlGetOptions,
  ): Promise<T>;
  /** Drop all entries (used between tests / on manual invalidation). */
  clear(): void;
}

export function createTtlCache(options: TtlCacheOptions): TtlCache {
  const { ttlMs } = options;
  const clock = options.clock ?? (() => Date.now());

  const store = new Map<string, Entry<unknown>>();
  // In-flight loads, so concurrent gets for the same key share one loader call
  // rather than each firing their own Airtable fetch.
  const inflight = new Map<string, Promise<unknown>>();

  async function load<T>(key: string, loader: () => Promise<T>): Promise<T> {
    const existing = inflight.get(key) as Promise<T> | undefined;
    if (existing) return existing;

    const p = (async () => {
      const value = await loader();
      // Only a successful load is memoized; a rejection leaves the cache empty
      // so the next call retries rather than serving a stored error.
      store.set(key, { value, expiresAt: clock() + ttlMs });
      return value;
    })();

    inflight.set(key, p);
    try {
      return await p;
    } finally {
      inflight.delete(key);
    }
  }

  return {
    async get<T>(
      key: string,
      loader: () => Promise<T>,
      opts: TtlGetOptions = {},
    ): Promise<T> {
      if (!opts.forceRefresh) {
        const hit = store.get(key) as Entry<T> | undefined;
        if (hit && hit.expiresAt > clock()) return hit.value;
      }
      return load(key, loader);
    },
    clear() {
      store.clear();
      inflight.clear();
    },
  };
}
