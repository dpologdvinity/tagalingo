/**
 * Moving content between files and the database. Shared by the seed, the CLI scripts
 * (content:generate / content:export) and the Studio server actions.
 *
 * Takes a PrismaClient argument instead of importing the app's `db` so it also runs in plain
 * Node scripts (the app client is guarded by `server-only`).
 *
 * File layout:
 *   content/<lang>/course.yaml               structure + word lists (hand-written)
 *   content/<lang>/exercises/<skill>.json    APPROVED exercises (exported after review)
 */
import fs from "node:fs";
import path from "node:path";
import { z } from "zod";
import type { PrismaClient } from "@/generated/prisma/client";
import { lessonRequest, type CourseDefinition } from "./course";
import type { ExerciseGenerator } from "./generators/types";
import { EXERCISE_TYPES, parseExercise } from "./schema";

/** Insert or update course → units → skills → lessons → words to match course.yaml. */
export async function syncCourseStructure(prisma: PrismaClient, def: CourseDefinition) {
  const course = await prisma.course.upsert({
    where: { slug: def.course.slug },
    create: def.course,
    update: { title: def.course.title, fromLang: def.course.fromLang, toLang: def.course.toLang },
  });
  for (const [ui, u] of def.units.entries()) {
    const unitData = { courseId: course.id, order: ui + 1, title: u.title, subtitle: u.subtitle, color: u.color };
    const unit = await prisma.unit.upsert({ where: { slug: u.slug }, create: { slug: u.slug, ...unitData }, update: unitData });
    for (const [si, s] of u.skills.entries()) {
      const skillData = { unitId: unit.id, order: si + 1, title: s.title, emoji: s.emoji, description: s.description };
      const skill = await prisma.skill.upsert({ where: { slug: s.slug }, create: { slug: s.slug, ...skillData }, update: skillData });
      for (const [li, l] of s.lessons.entries()) {
        await prisma.lesson.upsert({
          where: { skillId_order: { skillId: skill.id, order: li + 1 } },
          create: { skillId: skill.id, order: li + 1, title: l.title },
          update: { title: l.title },
        });
      }
      for (const w of s.words) {
        const wordData = {
          english: w.en,
          partOfSpeech: w.pos,
          notes: w.note ?? null,
          exampleTl: w.ex[0],
          exampleEn: w.ex[1],
        };
        await prisma.word.upsert({
          where: { skillId_tagalog: { skillId: skill.id, tagalog: w.tl } },
          create: { skillId: skill.id, tagalog: w.tl, ...wordData },
          update: wordData,
        });
      }
    }
  }
  return course;
}

/**
 * Generate DRAFT exercises for one lesson and append them after its existing exercises.
 * Returns the GenerationRun id and how many drafts were created.
 */
export async function generateDraftsForLesson(
  prisma: PrismaClient,
  generator: ExerciseGenerator,
  def: CourseDefinition,
  target: { skillSlug: string; lessonOrder: number },
  requestedById?: string,
) {
  const skillDef = def.units.flatMap((u) => u.skills).find((s) => s.slug === target.skillSlug);
  if (!skillDef) throw new Error(`Skill "${target.skillSlug}" is not in course.yaml`);
  const skill = await prisma.skill.findUniqueOrThrow({ where: { slug: target.skillSlug } });
  const lesson = await prisma.lesson.findUniqueOrThrow({
    where: { skillId_order: { skillId: skill.id, order: target.lessonOrder } },
  });

  let result;
  try {
    result = await generator.generate(lessonRequest(skillDef, target.lessonOrder - 1));
  } catch (e) {
    const error = e instanceof Error ? e.message : String(e);
    await prisma.generationRun.create({
      data: { skillId: skill.id, provider: generator.provider, model: generator.model, requestedById, error },
    });
    throw e;
  }

  const last = await prisma.exercise.aggregate({ where: { lessonId: lesson.id }, _max: { order: true } });
  const start = (last._max.order ?? 0) + 1;
  const run = await prisma.generationRun.create({
    data: {
      skillId: skill.id,
      provider: generator.provider,
      model: generator.model,
      requestedById,
      exerciseCount: result.exercises.length,
      error: result.rejected.length ? `${result.rejected.length} item(s) failed validation: ${result.rejected.map((r) => r.reason).join(" | ")}` : null,
    },
  });
  await prisma.exercise.createMany({
    data: result.exercises.map((ex, i) => ({
      lessonId: lesson.id,
      order: start + i,
      type: ex.type,
      payload: ex.payload,
      status: "DRAFT" as const,
      source: generator.provider === "claude" ? ("CLAUDE" as const) : ("STUB" as const),
      generationRunId: run.id,
    })),
  });
  return { runId: run.id, created: result.exercises.length, rejected: result.rejected.length };
}

const exportFileSchema = z.object({
  skill: z.string(),
  lessons: z.array(
    z.object({
      order: z.number().int().positive(),
      title: z.string(),
      exercises: z.array(
        z.object({
          type: z.enum(EXERCISE_TYPES),
          payload: z.unknown(),
          source: z.enum(["HUMAN", "CLAUDE", "STUB"]),
          reviewNote: z.string().nullish(),
        }),
      ),
    }),
  ),
});
export type ExportFile = z.infer<typeof exportFileSchema>;

const exercisesDir = (contentDir: string) => path.join(contentDir, "exercises");

/** Write every skill's APPROVED exercises to content/<lang>/exercises/<skill>.json. */
export async function exportApprovedExercises(prisma: PrismaClient, contentDir: string) {
  const skills = await prisma.skill.findMany({
    orderBy: [{ unit: { order: "asc" } }, { order: "asc" }],
    include: {
      lessons: {
        orderBy: { order: "asc" },
        include: { exercises: { where: { status: "APPROVED" }, orderBy: [{ order: "asc" }, { createdAt: "asc" }] } },
      },
    },
  });
  fs.mkdirSync(exercisesDir(contentDir), { recursive: true });
  const written: string[] = [];
  for (const skill of skills) {
    if (!skill.lessons.some((l) => l.exercises.length)) continue;
    const file: ExportFile = {
      skill: skill.slug,
      lessons: skill.lessons.map((l) => ({
        order: l.order,
        title: l.title,
        exercises: l.exercises.map((e) => ({ type: e.type, payload: e.payload, source: e.source, reviewNote: e.reviewNote })),
      })),
    };
    const target = path.join(exercisesDir(contentDir), `${skill.slug}.json`);
    fs.writeFileSync(target, JSON.stringify(file, null, 2) + "\n");
    written.push(target);
  }
  return written;
}

/** Read exported files and insert their exercises as APPROVED. Returns skills that had a file. */
export async function importApprovedExercises(prisma: PrismaClient, contentDir: string, reviewedById?: string) {
  const dir = exercisesDir(contentDir);
  if (!fs.existsSync(dir)) return new Set<string>();
  const imported = new Set<string>();
  for (const name of fs.readdirSync(dir).filter((f) => f.endsWith(".json")).sort()) {
    const file = exportFileSchema.parse(JSON.parse(fs.readFileSync(path.join(dir, name), "utf8")));
    const skill = await prisma.skill.findUnique({ where: { slug: file.skill } });
    if (!skill) throw new Error(`${name}: skill "${file.skill}" is not in course.yaml`);
    for (const l of file.lessons) {
      const lesson = await prisma.lesson.findUniqueOrThrow({ where: { skillId_order: { skillId: skill.id, order: l.order } } });
      await prisma.exercise.createMany({
        data: l.exercises.map((e, i) => {
          const parsed = parseExercise(e.type, e.payload); // reject corrupt files loudly
          return {
            lessonId: lesson.id,
            order: i + 1,
            type: parsed.type,
            payload: parsed.payload,
            status: "APPROVED" as const,
            source: e.source,
            reviewNote: e.reviewNote ?? null,
            reviewedById: reviewedById ?? null,
            reviewedAt: new Date(),
          };
        }),
      });
    }
    imported.add(file.skill);
  }
  return imported;
}
