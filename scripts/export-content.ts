/**
 * Export every APPROVED exercise to content/tagalog/exercises/<skill>.json and the course's APPROVED
 * verb tables to content/tagalog/grammar/verbs.json so reviewed content is version-controlled and
 * loaded by the seed on any machine. Verb tables are checked against course.yaml first, as the seed
 * import checks them.
 *
 *   npm run content:export             (refuses to empty an existing verbs.json when no tables are approved)
 *   npm run content:export -- --force  (empty it anyway)
 */
import "dotenv/config";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../src/generated/prisma/client";
import { loadCourseFile } from "../src/lib/content/course";
import { COURSE_FILE, CONTENT_DIR } from "../src/lib/content/paths";
import { exportVerbTables } from "../src/lib/content/grammar-persist";
import { exportApprovedExercises } from "../src/lib/content/persist";
import { LOCAL_DATABASE_URL } from "../src/lib/env-defaults";

async function main() {
  const prisma = new PrismaClient({
    adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL || LOCAL_DATABASE_URL }),
  });
  try {
    const files = await exportApprovedExercises(prisma, CONTENT_DIR);
    const verbs = await exportVerbTables(prisma, loadCourseFile(COURSE_FILE), CONTENT_DIR, {
      force: process.argv.includes("--force"),
    });
    if (verbs) files.push(verbs);
    console.log(files.length ? `Wrote:\n  ${files.join("\n  ")}` : "No approved exercises or verb tables to export.");
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
