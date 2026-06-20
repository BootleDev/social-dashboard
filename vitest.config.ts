import { defineConfig } from "vitest/config";
import path from "path";

export default defineConfig({
  test: {
    environment: "jsdom",
    globals: true,
    // Web Storage shim — neutralises the Node 25 native-localStorage shadowing
    // that breaks jsdom's localStorage (see vitest.setup.ts). No-op on the
    // behaviour CI (Node 24) already sees.
    setupFiles: ["./vitest.setup.ts"],
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
});
