import { defineConfig } from "vitest/config";
import path from "node:path";

export default defineConfig({
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "."),
    },
  },
  test: {
    environment: "node",
    include: ["tests/**/*.test.ts"],
    setupFiles: ["./tests/setup.ts"],
    // one process per test file: env-based data-dir isolation stays airtight
    pool: "forks",
    testTimeout: 180_000,
    hookTimeout: 60_000,
  },
});
