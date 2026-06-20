// Vitest global setup — Web Storage shim for the test environment.
//
// WHY: Node 22+ ships a native global `localStorage` (Web Storage API). On
// Node 24 (CI + Vercel) it is inert and jsdom's own working `localStorage`
// is used, so the suite is green. On Node 25 the native global is present but
// non-functional unless `--localstorage-file` points at a real file (it does
// not), so `globalThis.localStorage` is an empty plain object with no
// `getItem`/`setItem`/`clear` — and it SHADOWS jsdom's localStorage in the
// vitest jsdom env (globalThis.localStorage === window.localStorage). Tests
// that touch localStorage then fail with "localStorage.clear is not a function"
// on Node 25 only.
//
// FIX: install a spec-minimal in-memory Storage on both globalThis and window,
// unconditionally, so the test env behaves IDENTICALLY on Node 24 and Node 25
// (and matches a real browser for the methods the app uses: getItem/setItem/
// removeItem/clear/key/length). This does not mask real behaviour — it gives
// the SAME working Storage the app sees in a browser; it simply doesn't rely on
// whichever localStorage the host Node version happens to expose.

class MemoryStorage implements Storage {
  private store = new Map<string, string>();
  get length(): number {
    return this.store.size;
  }
  clear(): void {
    this.store.clear();
  }
  getItem(key: string): string | null {
    return this.store.has(key) ? (this.store.get(key) as string) : null;
  }
  key(index: number): string | null {
    return Array.from(this.store.keys())[index] ?? null;
  }
  removeItem(key: string): void {
    this.store.delete(key);
  }
  setItem(key: string, value: string): void {
    this.store.set(key, String(value));
  }
}

function install(name: "localStorage" | "sessionStorage"): void {
  const value = new MemoryStorage();
  Object.defineProperty(globalThis, name, {
    value,
    configurable: true,
    writable: true,
  });
  // jsdom's window is usually the same object as globalThis under vitest, but
  // define it explicitly too in case they diverge.
  const win = (globalThis as { window?: object }).window;
  if (win && win !== (globalThis as object)) {
    Object.defineProperty(win, name, {
      value,
      configurable: true,
      writable: true,
    });
  }
}

install("localStorage");
install("sessionStorage");
