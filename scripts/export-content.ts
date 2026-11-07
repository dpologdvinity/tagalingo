/**
 * Export every APPROVED exercise to content/tagalog/exercises/<skill>.json so reviewed content
 * is version-controlled and loaded by the seed on any machine.
 *
 *   npm run content:export
 */
import "dotenv/config";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../src/generated/prisma/client";
import { CONTENT_DIR } from "../src/lib/content/paths";
import { exportApprovedExercises } from "../src/lib/content/persist";
import { LOCAL_DATABASE_URL } from "../src/lib/env-defaults";

async function main() {
  const prisma = new PrismaClient({
    adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL || LOCAL_DATABASE_URL }),
  });
  try {
    const files = await exportApprovedExercises(prisma, CONTENT_DIR);
    console.log(files.length ? `Wrote:\n  ${files.join("\n  ")}` : "No approved exercises to export.");
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
