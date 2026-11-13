/**
 * Grammar patterns from the learner's side: which patterns are unlocked, how strong each one is,
 * the cards an attempt shows, and word lookup against the reviewed verb tables.
 *
 * A pattern unlocks when the learner finishes the lesson that teaches it (`PatternProgress.seenAt`,
 * set by `completeAttempt`). Lessons finished before grammar patterns existed have no `seenAt`, so a
 * completed teaching lesson counts as well. Strength is stored before time decay; everything here
 * reads it through `effectiveStrength` at the caller's `now`.
 */
import "server-only";
import { db } from "@/lib/db";
import { loadApprovedVerbTables } from "@/lib/content/grammar-persist";
import type { PatternCard } from "@/lib/content/grammar-schema";
import { effectiveStrength, strengthLabel, type StrengthLabel } from "@/lib/game/strength";
import { analyse, type Analysis } from "@/lib/grammar/analyse";
import type { Prisma } from "@/generated/prisma/client";

/** A pattern card as the lesson player receives it; `isNew` means "introduce it in this lesson". */
export type LessonCard = { slug: string; title: string; card: PatternCard; isNew: boolean };

/** One row of the grammar page. Locked patterns show their title only, so `card` is null for them. */
export type GrammarOverviewItem = {
  slug: string;
  title: string;
  order: number;
  unlocked: boolean;
  card: PatternCard | null;
  label: StrengthLabel;
  /** Strength after time decay, 0-1. */
  effective: number;
  /** The skill whose lesson teaches the pattern. */
  skillTitle: string;
};

/** Patterns whose drills `weakestPatterns` considers need at least this many answers. */
const WEAK_MIN_ATTEMPTS = 3;

/** True once the learner has seen the pattern's card, or finished the lesson that teaches it. */
export function isUnlocked(progress: { seenAt: Date | null } | undefined, teachingLessonCompleted: boolean): boolean {
  return progress?.seenAt != null || teachingLessonCompleted;
}

/**
 * The learner-facing card: the stored JSON plus the pattern's title. The JSON is written only by
 * `syncGrammar` from validated course.yaml (`{ rule, table?, examples, notes, mistakes }`).
 */
export function cardOf(pattern: { title: string; card: Prisma.JsonValue }): PatternCard {
  return { ...(pattern.card as Omit<PatternCard, "title">), title: pattern.title };
}

/**
 * Cards and pattern tags for the exercises an attempt serves. `cards` holds every pattern tagged on
 * any of them, in course order; `exercisePatterns` maps each tagged exercise to its pattern slugs
 * (tags are not secret). A card is new only in a lesson attempt (`lessonId` set) that teaches the
 * pattern, while the learner hasn't unlocked it yet; practice never introduces patterns.
 */
export async function attemptGrammar(
  userId: string,
  exerciseIds: string[],
  lessonId: string | null,
): Promise<{ cards: LessonCard[]; exercisePatterns: Record<string, string[]> }> {
  const tags = await db.exercisePattern.findMany({
    where: { exerciseId: { in: exerciseIds } },
    include: { pattern: { include: { progress: { where: { userId } } } } },
    orderBy: [{ pattern: { order: "asc" } }, { pattern: { slug: "asc" } }],
  });
  const lessonDone = lessonId !== null && (await db.lessonProgress.count({ where: { userId, lessonId } })) > 0;

  const exercisePatterns: Record<string, string[]> = {};
  const cards = new Map<string, LessonCard>();
  for (const { exerciseId, pattern } of tags) {
    (exercisePatterns[exerciseId] ??= []).push(pattern.slug);
    if (cards.has(pattern.slug)) continue;
    const isNew = pattern.lessonId === lessonId && !isUnlocked(pattern.progress[0], lessonDone);
    cards.set(pattern.slug, { slug: pattern.slug, title: pattern.title, card: cardOf(pattern), isNew });
  }
  return { cards: [...cards.values()], exercisePatterns };
}

/** Every pattern in course order with the learner's progress, unlock state and decayed strength. */
async function patternStates(userId: string, now: Date) {
  const patterns = await db.grammarPattern.findMany({
    orderBy: [{ order: "asc" }, { slug: "asc" }],
    include: { progress: { where: { userId } }, lesson: { select: { skill: { select: { title: true } } } } },
  });
  const finished = await db.lessonProgress.findMany({
    where: { userId, lessonId: { in: patterns.map((p) => p.lessonId) } },
    select: { lessonId: true },
  });
  const done = new Set(finished.map((f) => f.lessonId));
  return patterns.map((pattern) => {
    const progress = pattern.progress[0];
    return {
      pattern,
      attempts: progress?.attempts ?? 0,
      unlocked: isUnlocked(progress, done.has(pattern.lessonId)),
      effective: progress ? effectiveStrength(progress.strength, progress.lastPracticedAt, now) : 0,
    };
  });
}

/** The grammar page: every pattern in course order; locked ones without their card. */
export async function getGrammarOverview(userId: string, now: Date): Promise<GrammarOverviewItem[]> {
  return (await patternStates(userId, now)).map(({ pattern, attempts, unlocked, effective }) => ({
    slug: pattern.slug,
    title: pattern.title,
    order: pattern.order,
    unlocked,
    card: unlocked ? cardOf(pattern) : null,
    label: strengthLabel(effective, attempts),
    effective,
    skillTitle: pattern.lesson.skill.title,
  }));
}

/**
 * Slugs of the `n` unlocked patterns with the lowest effective strength, weakest first. Patterns
 * with fewer than WEAK_MIN_ATTEMPTS answers are left out: their strength says too little yet.
 */
export async function weakestPatterns(userId: string, now: Date, n = 3): Promise<string[]> {
  return (await patternStates(userId, now))
    .filter((s) => s.unlocked && s.attempts >= WEAK_MIN_ATTEMPTS)
    .sort((a, b) => a.effective - b.effective) // stable, so ties keep course order
    .slice(0, n)
    .map((s) => s.pattern.slug);
}

/** Every reading of `word` in the course's approved verb tables (the app has a single course). */
export async function lookupWord(word: string): Promise<Analysis[]> {
  const course = await db.course.findFirst({ select: { id: true } });
  if (!course) return [];
  return analyse(word, await loadApprovedVerbTables(db, course.id));
}
