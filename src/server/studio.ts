/**
 * Read models for the content Studio (reviewer-only).
 */
import "server-only";
import { db } from "@/lib/db";
import { lintExercise, safeParseExercise, type ExerciseType, type ParsedExercise } from "@/lib/content/schema";
import type { ExerciseSource, ExerciseStatus } from "@/generated/prisma/enums";

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
            },
          },
        },
      },
    },
  });
  if (!skill) return null;
  return {
    ...skill,
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
        };
      }),
    })),
  };
}
