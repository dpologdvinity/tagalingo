/**
 * Vitest config: unit tests for pure game logic, content validation and generators.
 * End-to-end tests live in /e2e and run with Playwright instead.
 */
import { defineConfig } from "vitest/config";
import path from "node:path";

export default defineConfig({
  resolve: {
    alias: { "@": path.resolve(__dirname, "src") },
  },
  test: {
    include: ["src/**/*.test.ts"],
    environment: "node",
    coverage: {
      provider: "v8",
      include: ["src/lib/**/*.ts"],
      exclude: ["src/lib/**/*.test.ts", "src/generated/**"],
      reporter: ["text-summary", "lcov"],
    },
  },
});
