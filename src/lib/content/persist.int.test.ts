import { afterAll, describe, expect, it } from "vitest";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "@/generated/prisma/client";
import { loadCourseFile } from "./course";
import { COURSE_FILE } from "./paths";
import { syncCourseStructure } from "./persist";

const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL! }) });

afterAll(async () => {
  // Restore the shipped order for other test files.
  await syncCourseStructure(prisma, loadCourseFile(COURSE_FILE));
  await prisma.$disconnect();
});

describe("syncCourseStructure", () => {
  it("handles skills being reordered in course.yaml", async () => {
    const course = loadCourseFile(COURSE_FILE);
    const reordered = structuredClone(course);
    reordered.units[0].skills.reverse();
    await expect(syncCourseStructure(prisma, reordered)).resolves.toBeDefined();

    const firstUnit = await prisma.unit.findUniqueOrThrow({
      where: { slug: course.units[0].slug },
      include: { skills: { orderBy: { order: "asc" } } },
    });
    expect(firstUnit.skills.map((s) => s.slug)).toEqual(reordered.units[0].skills.map((s) => s.slug));
  });
});
