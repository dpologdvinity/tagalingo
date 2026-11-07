/**
 * Integration tests: server services against a real Postgres (`*.int.test.ts`).
 *
 * Uses a dedicated `tagalingo_test` database (created + migrated + loaded with content by the
 * global setup), so running them never touches your dev data. Requires the docker-compose
 * database (`npm run db:up`) or TEST_DATABASE_URL.
 */
import { defineConfig } from "vitest/config";
import path from "node:path";

const TEST_DATABASE_URL =
  process.env.TEST_DATABASE_URL || "postgresql://tagalingo:tagalingo@localhost:5433/tagalingo_test";

export default defineConfig({
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "src"),
      // `server-only` throws outside a React Server Components bundle; tests run in plain Node.
      "server-only": path.resolve(__dirname, "src/test/empty-module.ts"),
    },
  },
  test: {
    include: ["src/**/*.int.test.ts"],
    environment: "node",
    globalSetup: ["src/test/integration-setup.ts"],
    env: { DATABASE_URL: TEST_DATABASE_URL, HEART_REFILL_MINUTES: "30" },
    fileParallelism: false,
    testTimeout: 20_000,
    hookTimeout: 120_000,
  },
});
