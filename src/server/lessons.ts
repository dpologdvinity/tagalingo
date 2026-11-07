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
 *  - completion is idempotent (the attempt flips IN_PROGRESS → COMPLETED exactly once).
 */
import "server-only";
import { db } from "@/lib/db";
import { heartRefillMs } from "@/lib/env";
import { toClientExercise, type ClientExercise } from "@/lib/content/client-view";
import { safeParseExercise, type ExerciseType, type ParsedExercise } from "@/lib/content/schema";
import { gradeAnswer } from "@/lib/game/grading";
import { liveHearts, loseHeart, MAX_HEARTS } from "@/lib/game/hearts";
import { applyLessonToStreak, dayKey } from "@/lib/game/streak";
import { xpForLesson, xpForPractice, type XpAward } from "@/lib/game/xp";
import { hash, rng, shuffle } from "@/lib/random";
import type { Prisma, User } from "@/generated/prisma/client";
import { canPlayLesson } from "./course";

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

export type StartedAttempt = { attemptId: string; exercises: ClientExercise[] };

/** Start a lesson: snapshot its approved exercises and return them (without answers). */
export async function startAttempt(user: User, lessonId: string, now = new Date()): Promise<StartedAttempt> {
  if (!(await canPlayLesson(user.id, lessonId))) throw new LessonError("locked", "This lesson is still locked");
  if (liveHearts(user, now, heartRefillMs()).hearts <= 0) throw new LessonError("no_hearts", "You're out of hearts");
  const lesson = await db.lesson.findUnique({ where: { id: lessonId }, include: { exercises: APPROVED_IN_ORDER } });
  const items = playable(lesson?.exercises ?? []);
  if (items.length === 0) throw new LessonError("not_found", "This lesson has no approved exercises yet");
  const attempt = await db.lessonAttempt.create({
    data: { userId: user.id, kind: "LESSON", lessonId, exerciseIds: items.map((i) => i.row.id) },
  });
  return { attemptId: attempt.id, exercises: items.map((i) => toClientExercise(i.row.id, i.parsed)) };
}

export type PracticeScope = { skillId: string } | { unitId: string };

/**
 * Start a practice session over lessons the learner has finished in a skill or unit. A random
 * mix of up to PRACTICE_SIZE approved exercises; no hearts required.
 */
export async function startPractice(user: User, scope: PracticeScope, now = new Date()): Promise<StartedAttempt> {
  const inScope = "skillId" in scope ? { skillId: scope.skillId } : { skill: { unitId: scope.unitId } };
  const finished = await db.lessonProgress.findMany({
    where: { userId: user.id, lesson: inScope },
    select: { lessonId: true },
  });
  if (finished.length === 0) throw new LessonError("locked", "Finish a lesson here first, then practise it.");
  const rows = await db.exercise.findMany({
    where: { lessonId: { in: finished.map((f) => f.lessonId) }, status: "APPROVED" },
    select: { id: true, type: true, payload: true },
    orderBy: { id: "asc" },
  });
  const picked = shuffle(playable(rows), rng(hash(`${user.id}:${now.getTime()}`))).slice(0, PRACTICE_SIZE);
  if (picked.length === 0) throw new LessonError("not_found", "There's nothing to practise here yet.");
  const attempt = await db.lessonAttempt.create({
    data: {
      userId: user.id,
      kind: "PRACTICE",
      ...("skillId" in scope ? { skillId: scope.skillId } : { unitId: scope.unitId }),
      exerciseIds: picked.map((p) => p.row.id),
    },
  });
  return { attemptId: attempt.id, exercises: picked.map((p) => toClientExercise(p.row.id, p.parsed)) };
}

export type AnswerFeedback = {
  correct: boolean;
  correctAnswer: string;
  typo: boolean;
  skipped: boolean;
  hearts: number;
  nextHeartAt: string | null;
  outOfHearts: boolean;
};

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

    const result = gradeAnswer(parsed, answer);
    await tx.attemptAnswer.create({ data: { attemptId, exerciseId, correct: result.correct, answer: answer ?? {} } });

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
