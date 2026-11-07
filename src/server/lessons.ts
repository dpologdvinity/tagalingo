/**
 * The core loop: start a lesson attempt, grade answers, complete the lesson.
 *
 * All rules are enforced here on the server; the client is only a view:
 *  - a lesson can be started only if it's unlocked and the learner has a heart left;
 *  - each answer is graded server-side, wrong answers cost a heart (not match_pairs);
 *  - running out of hearts fails the attempt;
 *  - completion requires a correct answer for every exercise in the lesson, and is
 *    idempotent (the attempt status flips IN_PROGRESS → COMPLETED exactly once).
 */
import "server-only";
import { db } from "@/lib/db";
import { heartRefillMs } from "@/lib/env";
import { toClientExercise, type ClientExercise } from "@/lib/content/client-view";
import { safeParseExercise, type ExerciseType } from "@/lib/content/schema";
import { gradeAnswer } from "@/lib/game/grading";
import { liveHearts, loseHeart } from "@/lib/game/hearts";
import { applyLessonToStreak, dayKey } from "@/lib/game/streak";
import { xpForLesson, type XpAward } from "@/lib/game/xp";
import type { User } from "@/generated/prisma/client";
import { canPlayLesson } from "./course";

export class LessonError extends Error {
  constructor(
    readonly code: "not_found" | "locked" | "no_hearts" | "not_in_progress" | "incomplete",
    message: string,
  ) {
    super(message);
    this.name = "LessonError";
  }
}

export type LessonForPlay = {
  id: string;
  title: string;
  skillTitle: string;
  skillEmoji: string;
  exercises: ClientExercise[];
};

/** Approved exercises of a lesson, in order, as answer-free client views. */
export async function getLessonForPlay(userId: string, lessonId: string): Promise<LessonForPlay> {
  const lesson = await db.lesson.findUnique({
    where: { id: lessonId },
    include: {
      skill: true,
      exercises: { where: { status: "APPROVED" }, orderBy: [{ order: "asc" }, { createdAt: "asc" }] },
    },
  });
  if (!lesson) throw new LessonError("not_found", "Lesson not found");
  if (!(await canPlayLesson(userId, lessonId))) throw new LessonError("locked", "This lesson is still locked");

  const exercises = lesson.exercises.flatMap((e) => {
    const parsed = safeParseExercise(e.type as ExerciseType, e.payload);
    return parsed ? [toClientExercise(e.id, parsed)] : []; // never serve corrupt rows
  });
  if (exercises.length === 0) throw new LessonError("not_found", "This lesson has no approved exercises yet");
  return {
    id: lesson.id,
    title: lesson.title,
    skillTitle: lesson.skill.title,
    skillEmoji: lesson.skill.emoji,
    exercises,
  };
}

export async function startAttempt(user: User, lessonId: string, now = new Date()) {
  if (!(await canPlayLesson(user.id, lessonId))) throw new LessonError("locked", "This lesson is still locked");
  if (liveHearts(user, now, heartRefillMs()).hearts <= 0) throw new LessonError("no_hearts", "You're out of hearts");
  const attempt = await db.lessonAttempt.create({ data: { userId: user.id, lessonId } });
  return { attemptId: attempt.id };
}

export type AnswerFeedback = {
  correct: boolean;
  correctAnswer: string;
  typo: boolean;
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
    const attempt = await tx.lessonAttempt.findFirst({ where: { id: attemptId, userId }, include: { user: true } });
    if (!attempt || attempt.status !== "IN_PROGRESS")
      throw new LessonError("not_in_progress", "This lesson attempt is over");

    const row = await tx.exercise.findFirst({
      where: { id: exerciseId, lessonId: attempt.lessonId, status: "APPROVED" },
    });
    const parsed = row && safeParseExercise(row.type as ExerciseType, row.payload);
    if (!row || !parsed) throw new LessonError("not_found", "Exercise not found in this lesson");

    const result = gradeAnswer(parsed, answer);
    await tx.attemptAnswer.create({ data: { attemptId, exerciseId, correct: result.correct, answer: answer ?? {} } });

    const refill = heartRefillMs();
    let hearts = liveHearts(attempt.user, now, refill);
    let outOfHearts = false;
    // Matching pairs gives per-tap feedback in the browser and never costs hearts.
    if (!result.correct && parsed.type !== "match_pairs") {
      const after = loseHeart(attempt.user, now, refill);
      await tx.user.update({ where: { id: userId }, data: after });
      await tx.lessonAttempt.update({ where: { id: attemptId }, data: { mistakes: { increment: 1 } } });
      hearts = liveHearts(after, now, refill);
      if (after.hearts === 0) {
        outOfHearts = true;
        await tx.lessonAttempt.update({ where: { id: attemptId }, data: { status: "FAILED", completedAt: now } });
      }
    }
    return {
      correct: result.correct,
      correctAnswer: result.correctAnswer,
      typo: !!result.typo,
      hearts: hearts.hearts,
      nextHeartAt: hearts.nextHeartAt?.toISOString() ?? null,
      outOfHearts,
    };
  });
}

export type LessonResult = {
  xp: XpAward;
  mistakes: number;
  streak: number;
  streakExtended: boolean;
  todayXp: number;
  dailyGoalXp: number;
  goalJustReached: boolean;
};

export async function completeAttempt(userId: string, attemptId: string, now = new Date()): Promise<LessonResult> {
  return db.$transaction(async (tx) => {
    const attempt = await tx.lessonAttempt.findFirst({ where: { id: attemptId, userId }, include: { user: true } });
    if (!attempt || attempt.status !== "IN_PROGRESS")
      throw new LessonError("not_in_progress", "This lesson attempt is over");
    const user = attempt.user;

    // Every approved exercise must have been answered correctly at least once in this attempt.
    const [required, correct] = await Promise.all([
      tx.exercise.findMany({ where: { lessonId: attempt.lessonId, status: "APPROVED" }, select: { id: true } }),
      tx.attemptAnswer.findMany({
        where: { attemptId, correct: true },
        select: { exerciseId: true },
        distinct: ["exerciseId"],
      }),
    ]);
    const done = new Set(correct.map((c) => c.exerciseId));
    if (required.some((r) => !done.has(r.id)))
      throw new LessonError("incomplete", "Some exercises are not finished yet");

    // Compare-and-swap so a double submit can't award XP twice.
    const flipped = await tx.lessonAttempt.updateMany({
      where: { id: attemptId, status: "IN_PROGRESS" },
      data: { status: "COMPLETED", completedAt: now },
    });
    if (flipped.count !== 1) throw new LessonError("not_in_progress", "This lesson attempt is over");

    const prior = await tx.lessonProgress.findUnique({
      where: { userId_lessonId: { userId, lessonId: attempt.lessonId } },
    });
    const xp = xpForLesson({ mistakes: attempt.mistakes, firstCompletion: !prior });
    const today = dayKey(now, user.timezone);
    const streak = applyLessonToStreak(user, today);

    await tx.lessonAttempt.update({ where: { id: attemptId }, data: { xpAwarded: xp.total } });
    await tx.user.update({
      where: { id: userId },
      data: {
        totalXp: { increment: xp.total },
        currentStreak: streak.currentStreak,
        longestStreak: streak.longestStreak,
        lastStreakDay: streak.lastStreakDay,
      },
    });
    await tx.xpEvent.create({ data: { userId, amount: xp.total, reason: "lesson", createdAt: now } });
    const activity = await tx.dailyActivity.upsert({
      where: { userId_day: { userId, day: today } },
      create: { userId, day: today, xp: xp.total, lessons: 1 },
      update: { xp: { increment: xp.total }, lessons: { increment: 1 } },
    });
    await tx.lessonProgress.upsert({
      where: { userId_lessonId: { userId, lessonId: attempt.lessonId } },
      create: { userId, lessonId: attempt.lessonId, firstCompletedAt: now },
      update: { timesCompleted: { increment: 1 } },
    });

    const before = activity.xp - xp.total;
    return {
      xp,
      mistakes: attempt.mistakes,
      streak: streak.currentStreak,
      streakExtended: streak.extended,
      todayXp: activity.xp,
      dailyGoalXp: user.dailyGoalXp,
      goalJustReached: before < user.dailyGoalXp && activity.xp >= user.dailyGoalXp,
    };
  });
}
