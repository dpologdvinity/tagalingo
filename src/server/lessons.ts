/**
 * The core loop: start an attempt (a lesson or a practice session), grade answers, complete it.
 *
 * All rules are enforced here on the server; the client is only a view:
 *  - a lesson can be started only if it's unlocked and the learner has a heart left;
 *  - practice reviews finished lessons, works with no hearts and never costs hearts;
 *  - every attempt snapshots exactly which exercises it served (`exerciseIds`), and only
 *    those can be answered; completion requires a correct answer for each of them;
 *  - each answer is graded server-side; wrong answers cost a heart in lessons (except
 *    match_pairs and speak, which give live feedback / depend on a microphone);
 *  - running out of hearts fails a lesson attempt;
 *  - completion is idempotent (the attempt flips IN_PROGRESS → COMPLETED exactly once);
 *  - the first answer to an exercise in an attempt (speak skips aside) updates the learner's
 *    strength in each grammar pattern it drills; completing a lesson unlocks the patterns it teaches.
 */
import "server-only";
import { db } from "@/lib/db";
import { heartRefillMs } from "@/lib/env";
import { toClientExercise, type ClientExercise } from "@/lib/content/client-view";
import { loadApprovedVerbTables } from "@/lib/content/grammar-persist";
import { safeParseExercise, type ExerciseType, type ParsedExercise } from "@/lib/content/schema";
import { gradeAnswer, type GradeContext } from "@/lib/game/grading";
import { liveHearts, loseHeart, MAX_HEARTS } from "@/lib/game/hearts";
import { applyLessonToStreak, dayKey } from "@/lib/game/streak";
import { effectiveStrength, updateStrength } from "@/lib/game/strength";
import { xpForLesson, xpForPractice, type XpAward } from "@/lib/game/xp";
import type { VerbForm } from "@/lib/grammar/types";
import { hash, rng, shuffle } from "@/lib/random";
import type { Prisma, User } from "@/generated/prisma/client";
import { canPlayLesson } from "./course";
import { attemptGrammar, cardOf, weakestPatterns, type LessonCard } from "./grammar";

export class LessonError extends Error {
  constructor(
    readonly code: "not_found" | "locked" | "no_hearts" | "not_in_progress" | "incomplete" | "invalid",
    message: string,
  ) {
    super(message);
    this.name = "LessonError";
  }
}

/** Exercise types whose mistakes never cost a heart. */
const FREE_MISTAKES: ReadonlySet<ExerciseType> = new Set(["match_pairs", "speak"]);

/** Max exercises in one practice session. */
export const PRACTICE_SIZE = 10;

/**
 * Serialise game-state writes for one learner: lock their User row for the rest of the
 * transaction. Without this, two concurrent wrong answers could both read 5 hearts and both
 * write 4, or two simultaneous completions could both claim the first-time bonus.
 */
async function lockLearner(tx: Prisma.TransactionClient, userId: string) {
  await tx.$queryRaw`SELECT id FROM "User" WHERE id = ${userId} FOR UPDATE`;
}

type ExerciseRow = { id: string; type: string; payload: unknown };

/** Parse rows, silently dropping any that no longer validate (never serve corrupt content). */
function playable<T extends ExerciseRow>(rows: T[]): { row: T; parsed: ParsedExercise }[] {
  return rows.flatMap((row) => {
    const parsed = safeParseExercise(row.type as ExerciseType, row.payload);
    return parsed ? [{ row, parsed }] : [];
  });
}

const APPROVED_IN_ORDER = {
  where: { status: "APPROVED" as const },
  orderBy: [{ order: "asc" as const }, { createdAt: "asc" as const }],
};

export type LessonInfo = { id: string; title: string; skillTitle: string; skillEmoji: string };

/** Lesson header info for the player page; throws if missing or locked. */
export async function getLessonInfo(userId: string, lessonId: string): Promise<LessonInfo> {
  const lesson = await db.lesson.findUnique({ where: { id: lessonId }, include: { skill: true } });
  if (!lesson) throw new LessonError("not_found", "Lesson not found");
  if (!(await canPlayLesson(userId, lessonId))) throw new LessonError("locked", "This lesson is still locked");
  return { id: lesson.id, title: lesson.title, skillTitle: lesson.skill.title, skillEmoji: lesson.skill.emoji };
}

export type StartedAttempt = {
  attemptId: string;
  exercises: ClientExercise[];
  /** Every grammar pattern tagged on a served exercise, in course order. */
  cards: LessonCard[];
  /** Exercise id → slugs of the patterns it drills; untagged exercises are absent. */
  exercisePatterns: Record<string, string[]>;
};

/** Start a lesson: snapshot its approved exercises and return them (without answers). */
export async function startAttempt(user: User, lessonId: string, now = new Date()): Promise<StartedAttempt> {
  if (!(await canPlayLesson(user.id, lessonId))) throw new LessonError("locked", "This lesson is still locked");
  if (liveHearts(user, now, heartRefillMs()).hearts <= 0) throw new LessonError("no_hearts", "You're out of hearts");
  const lesson = await db.lesson.findUnique({ where: { id: lessonId }, include: { exercises: APPROVED_IN_ORDER } });
  const items = playable(lesson?.exercises ?? []);
  if (items.length === 0) throw new LessonError("not_found", "This lesson has no approved exercises yet");
  const exerciseIds = items.map((i) => i.row.id);
  const attempt = await db.lessonAttempt.create({ data: { userId: user.id, kind: "LESSON", lessonId, exerciseIds } });
  return {
    attemptId: attempt.id,
    exercises: items.map((i) => toClientExercise(i.row.id, i.parsed)),
    ...(await attemptGrammar(user.id, exerciseIds, lessonId)),
  };
}

export type PracticeScope = { skillId: string } | { unitId: string } | { patternSlug: string } | { weakGrammar: true };

type Playable = ReturnType<typeof playable<ExerciseRow>>[number];
type Picked = { picked: Playable[]; scope: Prisma.LessonAttemptUncheckedCreateInput };

/** A random mix of approved exercises from the learner's finished lessons in a skill or unit. */
async function lessonPractice(
  userId: string,
  scope: { skillId: string } | { unitId: string },
  random: () => number,
): Promise<Picked> {
  const inScope = "skillId" in scope ? { skillId: scope.skillId } : { skill: { unitId: scope.unitId } };
  const finished = await db.lessonProgress.findMany({ where: { userId, lesson: inScope }, select: { lessonId: true } });
  if (finished.length === 0) throw new LessonError("locked", "Finish a lesson here first, then practise it.");
  const rows = await db.exercise.findMany({
    where: { lessonId: { in: finished.map((f) => f.lessonId) }, status: "APPROVED" },
    select: { id: true, type: true, payload: true },
    orderBy: { id: "asc" },
  });
  return { picked: shuffle(playable(rows), random).slice(0, PRACTICE_SIZE), scope: { userId, ...scope } };
}

/**
 * For each pattern id, its approved exercises from lessons the learner has finished, shuffled.
 * An exercise drilling several of the patterns appears in each of their lists.
 */
async function taggedExercises(userId: string, patternIds: string[], random: () => number) {
  const rows = await db.exercise.findMany({
    where: {
      status: "APPROVED",
      patterns: { some: { patternId: { in: patternIds } } },
      lesson: { progress: { some: { userId } } },
    },
    select: { id: true, type: true, payload: true, patterns: { select: { patternId: true } } },
    orderBy: { id: "asc" },
  });
  const items = shuffle(playable(rows), random);
  return patternIds.map((id) => items.filter((i) => i.row.patterns.some((p) => p.patternId === id)));
}

/** One item from each list in turn, skipping exercises already taken, until `size` or all lists run out. */
function interleave(lists: Playable[][], size: number): Playable[] {
  const out: Playable[] = [];
  const taken = new Set<string>();
  for (let i = 0; out.length < size && lists.some((l) => i < l.length); i++) {
    for (const item of lists.map((l) => l[i])) {
      if (!item || taken.has(item.row.id) || out.length >= size) continue;
      taken.add(item.row.id);
      out.push(item);
    }
  }
  return out;
}

/** Drills for one pattern, or mixed drills for the learner's weakest patterns. */
async function grammarPractice(
  userId: string,
  scope: { patternSlug: string } | { weakGrammar: true },
  now: Date,
  random: () => number,
): Promise<Picked> {
  if ("patternSlug" in scope) {
    const pattern = await db.grammarPattern.findFirst({ where: { slug: scope.patternSlug }, select: { id: true } });
    if (!pattern) throw new LessonError("not_found", "That grammar pattern doesn't exist.");
    const [drills] = await taggedExercises(userId, [pattern.id], random);
    return { picked: drills.slice(0, PRACTICE_SIZE), scope: { userId, patternId: pattern.id } };
  }
  const slugs = await weakestPatterns(userId, now);
  const patterns = await db.grammarPattern.findMany({
    where: { slug: { in: slugs } },
    select: { id: true, slug: true },
  });
  const ids = slugs.flatMap((slug) => patterns.filter((p) => p.slug === slug).map((p) => p.id));
  if (ids.length === 0)
    throw new LessonError("not_found", "Answer a few more grammar drills first, then practise your weakest ones.");
  return {
    picked: interleave(await taggedExercises(userId, ids, random), PRACTICE_SIZE),
    scope: { userId, weakGrammar: true },
  };
}

/**
 * Start a practice session over lessons the learner has finished: a skill or unit (a random mix of
 * their exercises), one grammar pattern (its drills) or the weakest grammar patterns (their drills
 * taken in turn). Up to PRACTICE_SIZE approved exercises; no hearts required.
 */
export async function startPractice(user: User, scope: PracticeScope, now = new Date()): Promise<StartedAttempt> {
  const random = rng(hash(`${user.id}:${now.getTime()}`));
  const { picked, scope: data } =
    "skillId" in scope || "unitId" in scope
      ? await lessonPractice(user.id, scope, random)
      : await grammarPractice(user.id, scope, now, random);
  if (picked.length === 0) throw new LessonError("not_found", "There's nothing to practise here yet.");
  const exerciseIds = picked.map((p) => p.row.id);
  const attempt = await db.lessonAttempt.create({ data: { ...data, kind: "PRACTICE", exerciseIds } });
  return {
    attemptId: attempt.id,
    exercises: picked.map((p) => toClientExercise(p.row.id, p.parsed)),
    ...(await attemptGrammar(user.id, exerciseIds, null)),
  };
}

export type AnswerFeedback = {
  correct: boolean;
  correctAnswer: string;
  typo: boolean;
  skipped: boolean;
  hearts: number;
  nextHeartAt: string | null;
  outOfHearts: boolean;
  /** Why a wrong answer is wrong (wrong verb form, known mistake, ...); null when correct or unexplained. */
  explanation: string | null;
  /** Paradigm only: the hidden cells filled wrongly. */
  wrongCells: VerbForm[] | null;
};

/** Exercise types built on one verb; grading loads that verb's approved tables to name wrong forms. */
const VERB_TYPES: ReadonlySet<ExerciseType> = new Set(["conjugate", "paradigm", "find_root"]);

/** What grading needs beyond the exercise: the verb's approved tables and the linked patterns' mistakes. */
async function gradeContext(
  tx: Prisma.TransactionClient,
  ex: ParsedExercise,
  lessonId: string,
  patterns: { slug: string; title: string; card: Prisma.JsonValue }[],
): Promise<GradeContext> {
  const patternMistakes = patterns.flatMap((p) => cardOf(p).mistakes);
  if (!VERB_TYPES.has(ex.type) || !("root" in ex.payload)) return { patternMistakes };
  const lesson = await tx.lesson.findUniqueOrThrow({
    where: { id: lessonId },
    select: { skill: { select: { unit: { select: { courseId: true } } } } },
  });
  return { patternMistakes, verbTables: await loadApprovedVerbTables(tx, lesson.skill.unit.courseId, ex.payload.root) };
}

/**
 * Fold one graded answer into the learner's progress on each pattern. The stored strength is decayed
 * to `now` first and the answer applied to that: `lastPracticedAt` resets to `now`, so updating the
 * raw value would discard the elapsed decay (a wrong answer after a long gap would raise strength).
 */
async function recordPatternAnswer(
  tx: Prisma.TransactionClient,
  userId: string,
  patternIds: string[],
  correct: boolean,
  now: Date,
) {
  for (const patternId of patternIds) {
    const where = { userId_patternId: { userId, patternId } };
    const prior = await tx.patternProgress.findUnique({ where, select: { strength: true, lastPracticedAt: true } });
    const decayed = prior ? effectiveStrength(prior.strength, prior.lastPracticedAt, now) : 0;
    const strength = updateStrength(decayed, correct);
    const right = correct ? 1 : 0;
    await tx.patternProgress.upsert({
      where,
      create: { userId, patternId, attempts: 1, correct: right, strength, lastPracticedAt: now },
      update: { attempts: { increment: 1 }, correct: { increment: right }, strength, lastPracticedAt: now },
    });
  }
}

/** Set `seenAt` on each pattern's progress where it isn't set yet, creating rows as needed. */
async function markSeen(tx: Prisma.TransactionClient, userId: string, patternIds: string[], now: Date) {
  await tx.patternProgress.createMany({
    data: patternIds.map((patternId) => ({ userId, patternId, seenAt: now })),
    skipDuplicates: true,
  });
  await tx.patternProgress.updateMany({
    where: { userId, patternId: { in: patternIds }, seenAt: null },
    data: { seenAt: now },
  });
}

export async function submitAnswer(
  userId: string,
  attemptId: string,
  exerciseId: string,
  answer: unknown,
  now = new Date(),
): Promise<AnswerFeedback> {
  return db.$transaction(async (tx) => {
    await lockLearner(tx, userId);
    const attempt = await tx.lessonAttempt.findFirst({ where: { id: attemptId, userId }, include: { user: true } });
    if (!attempt || attempt.status !== "IN_PROGRESS")
      throw new LessonError("not_in_progress", "This lesson attempt is over");

    // Only exercises served in this attempt can be answered. Older attempts (before snapshots)
    // fall back to "any approved exercise in the lesson".
    const served = attempt.exerciseIds.length > 0;
    if (served && !attempt.exerciseIds.includes(exerciseId))
      throw new LessonError("not_found", "Exercise not found in this lesson");
    const row = await tx.exercise.findFirst({
      where: served ? { id: exerciseId } : { id: exerciseId, lessonId: attempt.lessonId ?? "", status: "APPROVED" },
    });
    const parsed = row && safeParseExercise(row.type as ExerciseType, row.payload);
    if (!row || !parsed) throw new LessonError("not_found", "Exercise not found in this lesson");

    const links = await tx.exercisePattern.findMany({
      where: { exerciseId },
      select: { pattern: { select: { id: true, slug: true, title: true, card: true } } },
    });
    const patterns = links.map((l) => l.pattern);
    const result = gradeAnswer(parsed, answer, await gradeContext(tx, parsed, row.lessonId, patterns));
    // Only the first real try counts toward pattern strength: retries of a re-queued exercise would
    // otherwise turn every miss into a hit. A speak skip says nothing about the learner, so neither
    // it nor earlier skips count. Skips are stored as ordinary answers; re-grading tells them apart.
    const earlier = await tx.attemptAnswer.findMany({ where: { attemptId, exerciseId }, select: { answer: true } });
    const first = earlier.every((a) => gradeAnswer(parsed, a.answer).skipped === true);
    await tx.attemptAnswer.create({ data: { attemptId, exerciseId, correct: result.correct, answer: answer ?? {} } });
    if (first && !result.skipped) {
      await recordPatternAnswer(
        tx,
        userId,
        links.map((l) => l.pattern.id),
        result.correct,
        now,
      );
    }

    const refill = heartRefillMs();
    let hearts = liveHearts(attempt.user, now, refill);
    let outOfHearts = false;
    // Free exercises (match pairs, speaking) never count as mistakes: trying to speak shouldn't
    // cost the perfect bonus when skipping doesn't.
    if (!result.correct && !FREE_MISTAKES.has(parsed.type)) {
      await tx.lessonAttempt.update({ where: { id: attemptId }, data: { mistakes: { increment: 1 } } });
      // Practice is the way back from zero hearts, so it never costs any.
      if (attempt.kind === "LESSON") {
        const after = loseHeart(attempt.user, now, refill);
        await tx.user.update({ where: { id: userId }, data: after });
        hearts = liveHearts(after, now, refill);
        if (after.hearts === 0) {
          outOfHearts = true;
          await tx.lessonAttempt.update({ where: { id: attemptId }, data: { status: "FAILED", completedAt: now } });
        }
      }
    }
    return {
      correct: result.correct,
      correctAnswer: result.correctAnswer,
      typo: !!result.typo,
      skipped: !!result.skipped,
      hearts: hearts.hearts,
      nextHeartAt: hearts.nextHeartAt?.toISOString() ?? null,
      outOfHearts,
      explanation: result.explanation ?? null,
      wrongCells: result.wrongCells ?? null,
    };
  });
}

export type LessonResult = {
  kind: "LESSON" | "PRACTICE";
  xp: XpAward;
  mistakes: number;
  streak: number;
  streakExtended: boolean;
  todayXp: number;
  dailyGoalXp: number;
  goalJustReached: boolean;
  /** Hearts won back by this attempt (practice restores one). */
  heartsRestored: number;
};

export async function completeAttempt(userId: string, attemptId: string, now = new Date()): Promise<LessonResult> {
  return db.$transaction(async (tx) => {
    await lockLearner(tx, userId);
    const attempt = await tx.lessonAttempt.findFirst({ where: { id: attemptId, userId }, include: { user: true } });
    if (!attempt || attempt.status !== "IN_PROGRESS")
      throw new LessonError("not_in_progress", "This lesson attempt is over");
    const user = attempt.user;

    // Every exercise served in this attempt must have been answered correctly at least once.
    const required = attempt.exerciseIds.length
      ? attempt.exerciseIds
      : playable(
          await tx.exercise.findMany({
            where: { lessonId: attempt.lessonId ?? "", status: "APPROVED", createdAt: { lte: attempt.startedAt } },
            select: { id: true, type: true, payload: true },
          }),
        ).map((p) => p.row.id);
    const correct = await tx.attemptAnswer.findMany({
      where: { attemptId, correct: true },
      select: { exerciseId: true },
      distinct: ["exerciseId"],
    });
    const done = new Set(correct.map((c) => c.exerciseId));
    if (required.some((id) => !done.has(id)))
      throw new LessonError("incomplete", "Some exercises are not finished yet");

    // Compare-and-swap so a double submit can't award XP twice.
    const flipped = await tx.lessonAttempt.updateMany({
      where: { id: attemptId, status: "IN_PROGRESS" },
      data: { status: "COMPLETED", completedAt: now },
    });
    if (flipped.count !== 1) throw new LessonError("not_in_progress", "This lesson attempt is over");

    const isLesson = attempt.kind === "LESSON" && attempt.lessonId !== null;
    const prior = isLesson
      ? await tx.lessonProgress.findUnique({ where: { userId_lessonId: { userId, lessonId: attempt.lessonId! } } })
      : null;
    const xp = isLesson
      ? xpForLesson({ mistakes: attempt.mistakes, firstCompletion: !prior })
      : xpForPractice({ mistakes: attempt.mistakes });
    const today = dayKey(now, user.timezone);
    const streak = applyLessonToStreak(user, today);

    // Practice wins back one heart (on top of the time-based refill).
    const refill = heartRefillMs();
    const live = liveHearts(user, now, refill);
    const heartsRestored = !isLesson && live.hearts < MAX_HEARTS ? 1 : 0;
    const heartData = heartsRestored
      ? live.hearts + 1 >= MAX_HEARTS
        ? { hearts: MAX_HEARTS, heartsUpdatedAt: now }
        : { hearts: live.hearts + 1, heartsUpdatedAt: live.heartsUpdatedAt }
      : {};

    await tx.lessonAttempt.update({ where: { id: attemptId }, data: { xpAwarded: xp.total } });
    await tx.user.update({
      where: { id: userId },
      data: {
        totalXp: { increment: xp.total },
        currentStreak: streak.currentStreak,
        longestStreak: streak.longestStreak,
        lastStreakDay: streak.lastStreakDay,
        ...heartData,
      },
    });
    await tx.xpEvent.create({
      data: { userId, amount: xp.total, reason: isLesson ? "lesson" : "practice", createdAt: now },
    });
    const activity = await tx.dailyActivity.upsert({
      where: { userId_day: { userId, day: today } },
      create: { userId, day: today, xp: xp.total, lessons: 1 },
      update: { xp: { increment: xp.total }, lessons: { increment: 1 } },
    });
    if (isLesson) {
      await tx.lessonProgress.upsert({
        where: { userId_lessonId: { userId, lessonId: attempt.lessonId! } },
        create: { userId, lessonId: attempt.lessonId!, firstCompletedAt: now },
        update: { timesCompleted: { increment: 1 } },
      });
      // The learner has now seen this lesson's grammar cards; quitting part-way leaves them unseen.
      const taught = await tx.grammarPattern.findMany({ where: { lessonId: attempt.lessonId! }, select: { id: true } });
      const patternIds = taught.map((p) => p.id);
      if (patternIds.length > 0) await markSeen(tx, userId, patternIds, now);
    }

    const before = activity.xp - xp.total;
    return {
      kind: isLesson ? "LESSON" : "PRACTICE",
      xp,
      mistakes: attempt.mistakes,
      streak: streak.currentStreak,
      streakExtended: streak.extended,
      todayXp: activity.xp,
      dailyGoalXp: user.dailyGoalXp,
      goalJustReached: before < user.dailyGoalXp && activity.xp >= user.dailyGoalXp,
      heartsRestored,
    };
  });
}
