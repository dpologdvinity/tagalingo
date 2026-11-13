/**
 * The content Studio's data layer (reviewer-only): read models for the review pages, and the writes
 * behind the Studio's server actions (verb tables, grammar-card flags, exercise pattern tags).
 *
 * The writes are plain functions that take the acting user (or the course definition) as an
 * argument and return a `StudioResult`; they never check the role. `app/actions/studio.ts` wraps
 * each in a reviewer check and revalidation, which keeps this file testable without a session.
 */
import "server-only";
import { z } from "zod";
import { db } from "@/lib/db";
import type { CourseDefinition } from "@/lib/content/course";
import { courseVerbs, entryFor } from "@/lib/content/grammar-persist";
import { patternCardSchema, type PatternCard } from "@/lib/content/grammar-schema";
import { lintExercise, safeParseExercise, type ExerciseType, type ParsedExercise } from "@/lib/content/schema";
import { diffFromRule } from "@/lib/grammar/analyse";
import { AFFIXES, type Affix, type FormTable } from "@/lib/grammar/types";
import { verbFileEntrySchema } from "@/lib/grammar/verbs-file";
import type { ExerciseSource, ExerciseStatus } from "@/generated/prisma/enums";

/** What every Studio write reports back to the page. */
export type StudioResult = { ok: true; message: string } | { ok: false; message: string };

const ok = (message: string): StudioResult => ({ ok: true, message });
const fail = (message: string): StudioResult => ({ ok: false, message });

/** One line per validation issue: "completed.0: Too small ...". */
const issueSummary = (error: z.ZodError) =>
  error.issues.map((i) => `${i.path.join(".") || "forms"}: ${i.message}`).join("; ");

/** A table's `forms` JSON, as the verb file stores it. */
const formsSchema = verbFileEntrySchema.shape.forms;

export type StudioSkillRow = {
  id: string;
  title: string;
  emoji: string;
  unitTitle: string;
  counts: Record<ExerciseStatus, number>;
};

export async function getStudioOverview(): Promise<StudioSkillRow[]> {
  const [skills, grouped] = await Promise.all([
    db.skill.findMany({
      orderBy: [{ unit: { order: "asc" } }, { order: "asc" }],
      include: { unit: { select: { title: true } }, lessons: { select: { id: true } } },
    }),
    db.exercise.groupBy({ by: ["lessonId", "status"], _count: { _all: true } }),
  ]);
  return skills.map((s) => {
    const lessonIds = new Set(s.lessons.map((l) => l.id));
    const counts: Record<ExerciseStatus, number> = { DRAFT: 0, APPROVED: 0, REJECTED: 0 };
    for (const g of grouped) if (lessonIds.has(g.lessonId)) counts[g.status] += g._count._all;
    return { id: s.id, title: s.title, emoji: s.emoji, unitTitle: s.unit.title, counts };
  });
}

/** Counts for the Studio index's links to the grammar review pages. */
export async function getStudioGrammarCounts(): Promise<{ draftTables: number; openFlags: number }> {
  const [draftTables, openFlags] = await Promise.all([
    db.verbTable.count({ where: { status: "DRAFT" } }),
    db.cardFlag.count({ where: { resolvedAt: null } }),
  ]);
  return { draftTables, openFlags };
}

export type ReviewExercise = {
  id: string;
  order: number;
  status: ExerciseStatus;
  source: ExerciseSource;
  parsed: ParsedExercise | null;
  rawPayload: unknown;
  type: ExerciseType;
  warnings: string[];
  reviewNote: string | null;
  reviewedBy: string | null;
  reviewedAt: Date | null;
  generatedBy: string | null;
  /** The grammar patterns this exercise is tagged with, in course order. */
  patterns: { slug: string; title: string }[];
};

export async function getSkillForReview(skillId: string) {
  const skill = await db.skill.findUnique({
    where: { id: skillId },
    include: {
      unit: { select: { title: true } },
      words: { orderBy: { tagalog: "asc" } },
      generationRuns: { orderBy: { createdAt: "desc" }, take: 5 },
      lessons: {
        orderBy: { order: "asc" },
        include: {
          exercises: {
            orderBy: [{ order: "asc" }, { createdAt: "asc" }],
            include: {
              reviewedBy: { select: { name: true } },
              generationRun: { select: { provider: true, model: true } },
              patterns: {
                select: { pattern: { select: { slug: true, title: true } } },
                orderBy: [{ pattern: { order: "asc" } }, { pattern: { slug: "asc" } }],
              },
            },
          },
        },
      },
    },
  });
  if (!skill) return null;
  const patternOptions = await db.grammarPattern.findMany({
    orderBy: [{ order: "asc" }, { slug: "asc" }],
    select: { slug: true, title: true },
  });
  return {
    ...skill,
    /** Every pattern in the course, for the tag editor. */
    patternOptions,
    lessons: skill.lessons.map((l) => ({
      id: l.id,
      order: l.order,
      title: l.title,
      exercises: l.exercises.map((e): ReviewExercise => {
        const parsed = safeParseExercise(e.type as ExerciseType, e.payload);
        return {
          id: e.id,
          order: e.order,
          status: e.status,
          source: e.source,
          parsed,
          rawPayload: e.payload,
          type: e.type as ExerciseType,
          warnings: parsed ? lintExercise(parsed) : ["Payload no longer passes validation. Fix it before approving."],
          reviewNote: e.reviewNote,
          reviewedBy: e.reviewedBy?.name ?? null,
          reviewedAt: e.reviewedAt,
          generatedBy: e.generationRun ? `${e.generationRun.provider} (${e.generationRun.model})` : null,
          patterns: e.patterns.map((t) => t.pattern),
        };
      }),
    })),
  };
}

export type ReviewVerbTable = {
  id: string;
  root: string;
  affix: Affix;
  en: string;
  /** Null when the stored JSON no longer passes validation; `formsError` says why. */
  forms: FormTable | null;
  formsError?: string;
  irregular: string[];
  status: ExerciseStatus;
  reviewNote: string | null;
  reviewedBy: string | null;
  reviewedAt: Date | null;
};

/** The course's verb tables ordered by root then affix, optionally only those with `status`. */
export async function getVerbTablesForReview(status?: ExerciseStatus): Promise<ReviewVerbTable[]> {
  const rows = await db.verbTable.findMany({
    where: { status },
    include: { reviewedBy: { select: { name: true } } },
  });
  // Sorted here rather than in SQL so the affixes follow course order, as in verbs.json.
  return rows
    .sort((a, b) => (a.root < b.root ? -1 : a.root > b.root ? 1 : AFFIXES.indexOf(a.affix) - AFFIXES.indexOf(b.affix)))
    .map((r): ReviewVerbTable => {
      const parsed = formsSchema.safeParse(r.forms);
      return {
        id: r.id,
        root: r.root,
        affix: r.affix,
        en: r.en,
        forms: parsed.success ? parsed.data : null,
        ...(parsed.success ? {} : { formsError: issueSummary(parsed.error) }),
        irregular: r.irregular,
        status: r.status,
        reviewNote: r.reviewNote,
        reviewedBy: r.reviewedBy?.name ?? null,
        reviewedAt: r.reviewedAt,
      };
    });
}

/**
 * Store a reviewer's edit of a verb table. `formsJson` is the forms object; every cell must be a
 * non-empty list (index 0 canonical). `irregular` is recomputed against the rules for the table's
 * course.yaml verb entry, so it can never drift from the cells. The status is left alone: editing
 * does not approve.
 */
export async function saveVerbTable(
  def: CourseDefinition,
  userId: string,
  id: string,
  formsJson: string,
): Promise<StudioResult> {
  let json: unknown;
  try {
    json = JSON.parse(formsJson);
  } catch {
    return fail("The forms aren’t valid JSON.");
  }
  const parsed = formsSchema.safeParse(json);
  if (!parsed.success) return fail(`Check the forms. ${issueSummary(parsed.error)}`);

  const row = await db.verbTable.findUnique({ where: { id }, select: { root: true, affix: true } });
  if (!row) return fail("That verb table no longer exists.");
  let irregular: string[];
  try {
    irregular = diffFromRule(entryFor(courseVerbs(def), row, "Verb table"), row.affix, parsed.data);
  } catch (e) {
    return fail(e instanceof Error ? e.message : "Couldn’t compare the forms with the rules.");
  }
  await db.verbTable.update({
    where: { id },
    data: { forms: parsed.data, irregular, reviewedById: userId, reviewedAt: new Date() },
  });
  return ok("Saved.");
}

const tableStatus = z.enum(["APPROVED", "REJECTED", "DRAFT"]);

/** Approve, reject or return a verb table to drafts; the note is trimmed, capped at 500, and kept if blank. */
export async function reviewVerbTable(
  userId: string,
  id: string,
  status: string,
  note?: string,
): Promise<StudioResult> {
  const next = tableStatus.safeParse(status);
  if (!next.success) return fail("Unknown status.");
  const row = await db.verbTable.findUnique({ where: { id } });
  if (!row) return fail("That verb table no longer exists.");
  if (next.data === "APPROVED") {
    // Never approve a table the loaders would reject. `irregular` is always the recomputed diff.
    const parsed = formsSchema.safeParse(row.forms);
    if (!parsed.success) return fail(`Fix the forms before approving. ${issueSummary(parsed.error)}`);
  }
  await db.verbTable.update({
    where: { id },
    data: {
      status: next.data,
      reviewedById: userId,
      reviewedAt: new Date(),
      reviewNote: note?.trim() ? note.trim().slice(0, 500) : row.reviewNote,
    },
  });
  return ok(next.data === "APPROVED" ? "Approved." : next.data === "REJECTED" ? "Rejected." : "Moved back to drafts.");
}

export type ReviewFlag = { id: string; note: string; by: string; createdAt: Date; resolvedAt: Date | null };

export type ReviewPattern = {
  slug: string;
  title: string;
  skillTitle: string;
  /** The card as learners see it (title included); null when the stored JSON is invalid. */
  card: PatternCard | null;
  cardError?: string;
  /** How many exercises are tagged with this pattern. */
  taggedExercises: number;
  /** Oldest first. */
  flags: ReviewFlag[];
};

/** Every grammar pattern in course order, with its card, drill count and flags. */
export async function getGrammarForReview(): Promise<ReviewPattern[]> {
  const patterns = await db.grammarPattern.findMany({
    orderBy: [{ order: "asc" }, { slug: "asc" }],
    include: {
      lesson: { select: { skill: { select: { title: true } } } },
      flags: { orderBy: [{ createdAt: "asc" }, { id: "asc" }], include: { user: { select: { name: true } } } },
      _count: { select: { exercises: true } },
    },
  });
  return patterns.map((p): ReviewPattern => {
    const parsed = patternCardSchema.safeParse(p.card);
    return {
      slug: p.slug,
      title: p.title,
      skillTitle: p.lesson.skill.title,
      card: parsed.success ? { ...parsed.data, title: p.title } : null,
      ...(parsed.success ? {} : { cardError: issueSummary(parsed.error) }),
      taggedExercises: p._count.exercises,
      flags: p.flags.map((f) => ({
        id: f.id,
        note: f.note,
        by: f.user.name,
        createdAt: f.createdAt,
        resolvedAt: f.resolvedAt,
      })),
    };
  });
}

const flagNote = z
  .string()
  .trim()
  .min(1, "Say what is wrong with the card.")
  .max(500, "Keep the note under 500 characters.");

/** Record that `userId` found a problem with a pattern's card. */
export async function flagCard(userId: string, patternSlug: string, note: string): Promise<StudioResult> {
  const parsed = flagNote.safeParse(note);
  if (!parsed.success) return fail(parsed.error.issues[0].message);
  const pattern = await db.grammarPattern.findFirst({ where: { slug: patternSlug }, select: { id: true } });
  if (!pattern) return fail(`There is no grammar pattern “${patternSlug}”.`);
  await db.cardFlag.create({ data: { patternId: pattern.id, userId, note: parsed.data } });
  return ok("Flagged.");
}

/** Mark a flag resolved; resolving one that is already resolved changes nothing. */
export async function resolveFlag(flagId: string): Promise<StudioResult> {
  const { count } = await db.cardFlag.updateMany({
    where: { id: flagId, resolvedAt: null },
    data: { resolvedAt: new Date() },
  });
  if (count === 0 && !(await db.cardFlag.findUnique({ where: { id: flagId }, select: { id: true } })))
    return fail("That flag no longer exists.");
  return ok("Resolved.");
}

/**
 * Replace an exercise's pattern tags. Every slug must be a pattern of the exercise's course, and one
 * unknown slug fails the whole call, leaving the old tags as they were.
 */
export async function setExercisePatterns(exerciseId: string, slugs: string[]): Promise<StudioResult> {
  const exercise = await db.exercise.findUnique({
    where: { id: exerciseId },
    select: { lesson: { select: { skill: { select: { unit: { select: { courseId: true } } } } } } },
  });
  if (!exercise) return fail("That exercise no longer exists.");
  const wanted = [...new Set(slugs)];
  const patterns = await db.grammarPattern.findMany({
    where: { courseId: exercise.lesson.skill.unit.courseId, slug: { in: wanted } },
    select: { id: true, slug: true },
  });
  const unknown = wanted.filter((slug) => !patterns.some((p) => p.slug === slug));
  if (unknown.length) return fail(`Unknown grammar pattern${unknown.length === 1 ? "" : "s"}: ${unknown.join(", ")}.`);
  await db.$transaction([
    db.exercisePattern.deleteMany({ where: { exerciseId } }),
    db.exercisePattern.createMany({ data: patterns.map((p) => ({ exerciseId, patternId: p.id })) }),
  ]);
  return ok(patterns.length ? "Patterns saved." : "Patterns cleared.");
}
