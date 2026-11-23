/**
 * Vitest config: unit tests for pure game logic, content validation and generators.
 * End-to-end tests live in /e2e and run with Playwright instead.
 */
import { configDefaults, defineConfig } from "vitest/config";
import path from "node:path";

export default defineConfig({
  resolve: {
    alias: { "@": path.resolve(__dirname, "src") },
  },
  test: {
    include: ["src/**/*.test.ts"],
    // Integration tests need Postgres and have their own config (vitest.integration.config.ts).
    exclude: [...configDefaults.exclude, "src/**/*.int.test.ts"],
    environment: "node",
    coverage: {
      provider: "v8",
      include: ["src/lib/**/*.ts"],
      exclude: ["src/lib/**/*.test.ts", "src/generated/**"],
      // json-summary feeds the coverage table in the CI job summary.
      reporter: ["text-summary", "lcov", "json-summary"],
      // A floor about two points under today's numbers: a refactor can wobble, a dropped test can't.
      // Raise these when coverage improves.
      thresholds: { statements: 74, branches: 69, functions: 77, lines: 75 },
    },
  },
});
