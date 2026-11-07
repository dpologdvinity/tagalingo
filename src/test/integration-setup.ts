/**
 * Vitest global setup for integration tests: migrate the test database and load the shipped
 * course content into it (approved exercises only; no demo users).
 */
import { execSync } from "node:child_process";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "@/generated/prisma/client";
import { loadCourseFile } from "@/lib/content/course";
import { CONTENT_DIR, COURSE_FILE } from "@/lib/content/paths";
import { importApprovedExercises, syncCourseStructure } from "@/lib/content/persist";

export default async function setup() {
  const url = process.env.TEST_DATABASE_URL || "postgresql://tagalingo:tagalingo@localhost:5433/tagalingo_test";
  // `migrate deploy` creates the database if it doesn't exist yet.
  execSync("npx prisma migrate deploy", { env: { ...process.env, DATABASE_URL: url }, stdio: "pipe" });

  const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: url }) });
  try {
    await prisma.$executeRawUnsafe(
      'TRUNCATE "AttemptAnswer","LessonAttempt","LessonProgress","XpEvent","DailyActivity","Exercise","GenerationRun","Word","Lesson","Skill","Unit","Course","User" CASCADE',
    );
    await syncCourseStructure(prisma, loadCourseFile(COURSE_FILE));
    await importApprovedExercises(prisma, CONTENT_DIR);
  } finally {
    await prisma.$disconnect();
  }
}
