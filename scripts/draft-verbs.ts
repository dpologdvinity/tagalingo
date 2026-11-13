/**
 * Draft verb tables for review: every verb x affix in course.yaml that has no table yet gets a
 * DRAFT built from the morphology engine's rules, ready to correct and approve in /studio.
 *
 *   npm run grammar:draft
 *
 * Existing tables of any status are never touched, so it is safe to re-run after adding verbs.
 * Approved tables reach the repo through `npm run content:export`.
 */
import "dotenv/config";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../src/generated/prisma/client";
import { loadCourseFile } from "../src/lib/content/course";
import { draftVerbTables } from "../src/lib/content/grammar-persist";
import { COURSE_FILE } from "../src/lib/content/paths";
import { syncCourseStructure } from "../src/lib/content/persist";
import { LOCAL_DATABASE_URL } from "../src/lib/env-defaults";

async function main() {
  const prisma = new PrismaClient({
    adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL || LOCAL_DATABASE_URL }),
  });
  try {
    const course = loadCourseFile(COURSE_FILE);
    await syncCourseStructure(prisma, course); // the tables hang off the synced course
    const { created, unchanged, skipped } = await draftVerbTables(prisma, course);
    console.log(`Verb tables: ${created} drafted, ${unchanged} already existed.`);
    if (skipped.length) console.warn(`Skipped (the engine cannot conjugate them): ${skipped.join(", ")}`);
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exitCode = 1;
});
