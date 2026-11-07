/**
 * Generate DRAFT exercises from the word list, ready for review in /studio.
 *
 *   npm run content:generate -- --skill pamimili            # every lesson of a skill
 *   npm run content:generate -- --skill pamimili --lesson 2
 *   CONTENT_GENERATOR=claude ANTHROPIC_API_KEY=... npm run content:generate -- --skill mga-kulay
 *
 * The generator follows the same env rules as the app (see src/lib/content/generators/index.ts).
 * Drafts never reach learners until a reviewer approves them.
 */
import "dotenv/config";
import { parseArgs } from "node:util";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../src/generated/prisma/client";
import { loadCourseFile } from "../src/lib/content/course";
import { selectGenerator } from "../src/lib/content/generators";
import { COURSE_FILE } from "../src/lib/content/paths";
import { generateDraftsForLesson, syncCourseStructure } from "../src/lib/content/persist";
import { LOCAL_DATABASE_URL } from "../src/lib/env-defaults";

async function main() {
  const { values } = parseArgs({ options: { skill: { type: "string" }, lesson: { type: "string" } } });
  if (!values.skill) throw new Error("Usage: npm run content:generate -- --skill <slug> [--lesson <n>]");

  const prisma = new PrismaClient({
    adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL || LOCAL_DATABASE_URL }),
  });
  try {
    const course = loadCourseFile(COURSE_FILE);
    await syncCourseStructure(prisma, course); // pick up any word-list edits first
    const skill = course.units.flatMap((u) => u.skills).find((s) => s.slug === values.skill);
    if (!skill) throw new Error(`Unknown skill "${values.skill}"`);
    const lessons = values.lesson ? [Number(values.lesson)] : skill.lessons.map((_, i) => i + 1);
    const generator = selectGenerator();
    console.log(`Generator: ${generator.provider} (${generator.model})`);
    for (const lessonOrder of lessons) {
      const r = await generateDraftsForLesson(prisma, generator, course, { skillSlug: skill.slug, lessonOrder });
      console.log(
        `  ${skill.slug} lesson ${lessonOrder}: ${r.created} drafts${r.rejected ? `, ${r.rejected} rejected` : ""}`,
      );
    }
    console.log("Review them at /studio.");
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exitCode = 1;
});
