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
import { clientCard, patternCardSchema, type ClientCard, type PatternCard } from "@/lib/content/grammar-schema";
import { effectiveStrength, strengthLabel, type StrengthLabel } from "@/lib/game/strength";
import { analyse, type Analysis, type VerbTableData } from "@/lib/grammar/analyse";
import { LOOKUP_MAX_WORDS } from "@/lib/grammar/tokenize";
import { normalizeAnswer } from "@/lib/normalize";
import type { Prisma } from "@/generated/prisma/client";

/** A pattern card as the lesson player receives it; `isNew` means "introduce it in this lesson". */
export type LessonCard = { slug: string; title: string; card: ClientCard; isNew: boolean };

/** One row of the grammar page. Locked patterns show their title only, so `card` is null for them. */
export type GrammarOverviewItem = {
  slug: string;
  title: string;
  order: number;
  unlocked: boolean;
  card: ClientCard | null;
  label: StrengthLabel;
  /** Strength after time decay, 0-1. */
  effective: number;
  /** The skill whose lesson teaches the pattern. */
  skillId: string;
  skillTitle: string;
};

/** Patterns whose drills `weakestPatterns` considers need at least this many answers. */
const WEAK_MIN_ATTEMPTS = 3;

/** True once the learner has seen the pattern's card, or finished the lesson that teaches it. */
export function isUnlocked(progress: { seenAt: Date | null } | undefined, teachingLessonCompleted: boolean): boolean {
  return progress?.seenAt != null || teachingLessonCompleted;
}

/**
 * The learner-facing card: the stored JSON plus the pattern's title. `syncGrammar` writes the JSON
 * from validated course.yaml, but it is re-parsed here so a hand-edited row fails loudly, naming the
 * pattern, instead of sending a broken card to the client.
 */
export function cardOf(pattern: { slug: string; title: string; card: Prisma.JsonValue }): PatternCard {
  const parsed = patternCardSchema.safeParse(pattern.card);
  if (!parsed.success)
    throw new Error(`Grammar pattern "${pattern.slug}" has an invalid card: ${parsed.error.message}`);
  return { ...parsed.data, title: pattern.title };
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
    cards.set(pattern.slug, { slug: pattern.slug, title: pattern.title, card: clientCard(cardOf(pattern)), isNew });
  }
  return { cards: [...cards.values()], exercisePatterns };
}

/** Every pattern in course order with the learner's progress, unlock state and decayed strength. */
async function patternStates(userId: string, now: Date) {
  const patterns = await db.grammarPattern.findMany({
    orderBy: [{ order: "asc" }, { slug: "asc" }],
    include: { progress: { where: { userId } }, lesson: { select: { skill: { select: { id: true, title: true } } } } },
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
    card: unlocked ? clientCard(cardOf(pattern)) : null,
    label: strengthLabel(effective, attempts),
    effective,
    skillId: pattern.lesson.skill.id,
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

/** One verb table a word appears in, with the cells (readings) it matched there. */
export type VerbLookup = { table: VerbTableData; analyses: Analysis[] };

/**
 * Look several words up in one go (a chat message's worth): the approved tables load once, and each
 * distinct word, keyed by its `normalizeAnswer` form, maps to the tables it appears in. A word that
 * matches several cells of one table (kumain is both infinitive and past) is one entry with several
 * readings; words that match nothing are left out.
 */
export async function lookupWords(words: string[]): Promise<Record<string, VerbLookup[]>> {
  if (words.length > LOOKUP_MAX_WORDS) throw new Error(`lookupWords takes at most ${LOOKUP_MAX_WORDS} words`);
  const keys = [...new Set(words.map(normalizeAnswer).filter((key) => key !== ""))];
  const course = keys.length ? await db.course.findFirst({ select: { id: true } }) : null;
  if (!course) return {};
  const tables = await loadApprovedVerbTables(db, course.id);

  const found: Record<string, VerbLookup[]> = {};
  for (const key of keys) {
    const lookups = new Map<VerbTableData, VerbLookup>();
    for (const analysis of analyse(key, tables)) {
      const table = tables.find((t) => t.root === analysis.root && t.affix === analysis.affix);
      if (!table) continue; // unreachable: analyse only returns cells of the tables it was given
      const lookup = lookups.get(table) ?? { table, analyses: [] };
      lookup.analyses.push(analysis);
      lookups.set(table, lookup);
    }
    if (lookups.size) found[key] = [...lookups.values()];
  }
  return found;
}
