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
 *   content/<lang>/grammar/verbs.json        APPROVED verb tables (see grammar-persist.ts)
 */
import fs from "node:fs";
import path from "node:path";
import type { PrismaClient } from "@/generated/prisma/client";
import { lessonRequest, type CourseDefinition } from "./course";
import { loadApprovedVerbTables, syncGrammar } from "./grammar-persist";
import { GRAMMAR_AFTER } from "./generators/grammar-drills";
import type { ExerciseGenerator } from "./generators/types";
import { parseExercise } from "./schema";
import { exportFileSchema, type ExportFile } from "./shipped";

/** Insert or update course → units → skills → lessons → words and grammar patterns to match course.yaml. */
export async function syncCourseStructure(prisma: PrismaClient, def: CourseDefinition) {
  const course = await prisma.course.upsert({
    where: { slug: def.course.slug },
    create: def.course,
    update: { title: def.course.title, fromLang: def.course.fromLang, toLang: def.course.toLang },
  });
  // Shift existing positions out of the way first so reordering course.yaml can't collide with
  // the (courseId, order) / (unitId, order) unique indexes mid-sync.
  await prisma.unit.updateMany({ where: { courseId: course.id }, data: { order: { increment: 10_000 } } });
  await prisma.skill.updateMany({ where: { unit: { courseId: course.id } }, data: { order: { increment: 10_000 } } });
  for (const [ui, u] of def.units.entries()) {
    const unitData = { courseId: course.id, order: ui + 1, title: u.title, subtitle: u.subtitle, color: u.color };
    const unit = await prisma.unit.upsert({
      where: { slug: u.slug },
      create: { slug: u.slug, ...unitData },
      update: unitData,
    });
    for (const [si, s] of u.skills.entries()) {
      const skillData = {
        unitId: unit.id,
        order: si + 1,
        title: s.title,
        emoji: s.emoji,
        description: s.description,
        tips: s.tips,
        dialogues: s.dialogues,
      };
      const skill = await prisma.skill.upsert({
        where: { slug: s.slug },
        create: { slug: s.slug, ...skillData },
        update: skillData,
      });
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
          pic: w.pic ?? null,
        };
        await prisma.word.upsert({
          where: { skillId_tagalog: { skillId: skill.id, tagalog: w.tl } },
          create: { skillId: skill.id, tagalog: w.tl, ...wordData },
          update: wordData,
        });
      }
    }
  }
  await syncGrammar(prisma, def);
  return course;
}

/** `value` as JSON with object keys sorted, so two payloads that mean the same compare equal as strings. */
function canonicalJson(value: unknown): string {
  const sorted = (v: unknown): unknown =>
    Array.isArray(v)
      ? v.map(sorted)
      : v && typeof v === "object"
        ? Object.fromEntries(
            Object.entries(v)
              .sort(([a], [b]) => (a < b ? -1 : 1))
              .map(([k, x]) => [k, sorted(x)]),
          )
        : v;
  return JSON.stringify(sorted(value));
}

/**
 * Generate DRAFT exercises for one lesson and append them after its existing exercises.
 * The course's APPROVED verb tables are handed to the generator for grammar drills, and every
 * draft that drills a grammar pattern is tagged with it (`ExercisePattern`). Returns the
 * GenerationRun id, how many drafts were created and how many generated items were rejected
 * (vocabulary and grammar alike), with the reasons (also kept on the GenerationRun).
 *
 * With `grammarOnly` only the generator's tagged (grammar) drills are kept, so the lesson's existing
 * exercises, approved ones included, are never duplicated: a drill whose type and payload already
 * exist in the lesson, in any status (a reviewer's rejection is respected), is skipped and counted
 * in `skipped`, which makes re-running idempotent for a deterministic generator. The new drills are
 * inserted after the lesson's `GRAMMAR_AFTER`th exercise, where the stub generator puts them, and
 * the later exercises are renumbered to make room.
 */
export async function generateDraftsForLesson(
  prisma: PrismaClient,
  generator: ExerciseGenerator,
  def: CourseDefinition,
  target: { skillSlug: string; lessonOrder: number },
  requestedById?: string,
  options: { grammarOnly?: boolean } = {},
) {
  const skillDef = def.units.flatMap((u) => u.skills).find((s) => s.slug === target.skillSlug);
  if (!skillDef) throw new Error(`Skill "${target.skillSlug}" is not in course.yaml`);
  const skill = await prisma.skill.findUniqueOrThrow({ where: { slug: target.skillSlug }, include: { unit: true } });
  const lesson = await prisma.lesson.findUniqueOrThrow({
    where: { skillId_order: { skillId: skill.id, order: target.lessonOrder } },
  });

  // Anything that goes wrong before the drafts are written (the generator itself, or a tag naming a
  // pattern that is not in the course) is recorded as a failed GenerationRun, then rethrown.
  let result;
  let patternIds: Map<string, string>;
  try {
    const tables = await loadApprovedVerbTables(prisma, skill.unit.courseId);
    result = await generator.generate(lessonRequest(def, skillDef, target.lessonOrder - 1), tables);
    if (options.grammarOnly) result = { ...result, exercises: result.exercises.filter((e) => e.patterns.length > 0) };
    patternIds = new Map(
      (await prisma.grammarPattern.findMany({ where: { courseId: skill.unit.courseId } })).map((p) => [p.slug, p.id]),
    );
    for (const slug of result.exercises.flatMap((e) => e.patterns))
      if (!patternIds.has(slug)) throw new Error(`Generated exercise is tagged with unknown pattern "${slug}"`);
  } catch (e) {
    const error = e instanceof Error ? e.message : String(e);
    await prisma.generationRun.create({
      data: { skillId: skill.id, provider: generator.provider, model: generator.model, requestedById, error },
    });
    throw e;
  }

  const { rejected } = result;
  // One transaction: the run, the drafts and their pattern tags land together or not at all.
  const { runId, exercises } = await prisma.$transaction(async (tx) => {
    const existing = await tx.exercise.findMany({
      where: { lessonId: lesson.id },
      orderBy: [{ order: "asc" }, { createdAt: "asc" }],
      select: { order: true, type: true, payload: true },
    });
    let exercises = result.exercises;
    // Where the new drills start: after the lesson's last exercise, or in grammar-only mode after its 4th.
    let after = existing.at(-1)?.order ?? 0;
    if (options.grammarOnly) {
      const present = new Set(existing.map((e) => `${e.type}:${canonicalJson(e.payload)}`));
      exercises = exercises.filter((e) => !present.has(`${e.type}:${canonicalJson(e.payload)}`));
      // The position counts the lesson's rows of any status (drafts and rejected ones too), not just approved ones.
      after = existing[Math.min(GRAMMAR_AFTER, existing.length) - 1]?.order ?? 0;
      if (exercises.length)
        await tx.exercise.updateMany({
          where: { lessonId: lesson.id, order: { gt: after } },
          data: { order: { increment: exercises.length } },
        });
    }
    const start = after + 1;
    const run = await tx.generationRun.create({
      data: {
        skillId: skill.id,
        provider: generator.provider,
        model: generator.model,
        requestedById,
        exerciseCount: exercises.length,
        error: rejected.length
          ? `${rejected.length} item(s) failed validation: ${rejected.map((r) => r.reason).join(" | ")}`
          : null,
      },
    });
    const created = await tx.exercise.createManyAndReturn({
      data: exercises.map((ex, i) => ({
        lessonId: lesson.id,
        order: start + i,
        type: ex.type,
        payload: ex.payload,
        status: "DRAFT" as const,
        source: generator.provider === "claude" ? ("CLAUDE" as const) : ("STUB" as const),
        generationRunId: run.id,
      })),
      select: { id: true, order: true },
    });
    await tx.exercisePattern.createMany({
      data: created.flatMap(({ id, order }) =>
        exercises[order - start].patterns.map((slug) => ({ exerciseId: id, patternId: patternIds.get(slug)! })),
      ),
    });
    return { runId: run.id, exercises };
  });
  return {
    runId,
    created: exercises.length,
    skipped: result.exercises.length - exercises.length,
    rejected: rejected.length,
    rejectedReasons: rejected.map((r) => r.reason),
  };
}

const exercisesDir = (contentDir: string) => path.join(contentDir, "exercises");

/** Write every skill's APPROVED exercises to content/<lang>/exercises/<skill>.json. */
export async function exportApprovedExercises(prisma: PrismaClient, contentDir: string) {
  const skills = await prisma.skill.findMany({
    orderBy: [{ unit: { order: "asc" } }, { order: "asc" }],
    include: {
      lessons: {
        orderBy: { order: "asc" },
        include: {
          exercises: {
            where: { status: "APPROVED" },
            orderBy: [{ order: "asc" }, { createdAt: "asc" }],
            include: { patterns: { include: { pattern: { select: { slug: true } } } } },
          },
        },
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
        exercises: l.exercises.map((e) => ({
          type: e.type,
          payload: e.payload,
          source: e.source,
          reviewNote: e.reviewNote,
          patterns: e.patterns.map((p) => p.pattern.slug).sort(),
        })),
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
  for (const name of fs
    .readdirSync(dir)
    .filter((f) => f.endsWith(".json"))
    .sort()) {
    const file = exportFileSchema.parse(JSON.parse(fs.readFileSync(path.join(dir, name), "utf8")));
    const skill = await prisma.skill.findUnique({ where: { slug: file.skill }, include: { unit: true } });
    if (!skill) throw new Error(`${name}: skill "${file.skill}" is not in course.yaml`);
    const patternIds = new Map(
      (await prisma.grammarPattern.findMany({ where: { courseId: skill.unit.courseId } })).map((p) => [p.slug, p.id]),
    );
    for (const l of file.lessons) {
      const lesson = await prisma.lesson.findUniqueOrThrow({
        where: { skillId_order: { skillId: skill.id, order: l.order } },
      });
      // Check every tag first so a bad slug can't leave a half-imported lesson behind.
      for (const slug of l.exercises.flatMap((e) => e.patterns))
        if (!patternIds.has(slug)) throw new Error(`${name}: pattern "${slug}" is not in course.yaml`);
      // The exercises and their tags go in together, so a failed tag insert can't leave the lesson
      // half-imported, with exercises but no tags.
      await prisma.$transaction(async (tx) => {
        const created = await tx.exercise.createManyAndReturn({
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
          select: { id: true, order: true },
        });
        // Re-create the pattern tags; `order` is the exercise's position in the file (1-based).
        const tags = created.flatMap(({ id, order }) =>
          l.exercises[order - 1].patterns.map((slug) => ({ exerciseId: id, patternId: patternIds.get(slug)! })),
        );
        await tx.exercisePattern.createMany({ data: tags });
      });
    }
    imported.add(file.skill);
  }
  return imported;
}
