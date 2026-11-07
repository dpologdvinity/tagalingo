/**
 * Prisma CLI configuration (Prisma 7+).
 *
 * The datasource URL lives here rather than in schema.prisma. When DATABASE_URL is not set we
 * fall back to the docker-compose database so a fresh clone works with zero configuration.
 */
import "dotenv/config";
import { defineConfig } from "prisma/config";
import { LOCAL_DATABASE_URL } from "./src/lib/env-defaults";

export default defineConfig({
  schema: "prisma/schema.prisma",
  migrations: {
    path: "prisma/migrations",
    seed: "tsx prisma/seed.ts",
  },
  datasource: {
    url: process.env.DATABASE_URL || LOCAL_DATABASE_URL,
  },
});
