import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import { parseExercise, type ExerciseType, type ParsedExercise } from "@/lib/content/schema";
import type { User } from "@/generated/prisma/client";
import { completeAttempt, getLessonForPlay, startAttempt, submitAnswer } from "./lessons";
import { getPathForUser } from "./course";
import { getWeeklyLeaderboard } from "./leaderboard";

/** A correct answer for any exercise, derived from its payload. */
function correctAnswer(ex: ParsedExercise): unknown {
  switch (ex.type) {
    case "select_translation":
    case "fill_blank":
      return { choice: ex.payload.answerIndex };
    case "word_bank":
      return { tokens: ex.payload.answer };
    case "match_pairs":
      return { completed: true };
    case "type_translation":
      return { text: ex.payload.answers[0] };
  }
}

const wrongAnswer = (ex: ParsedExercise): unknown =>
  ex.type === "match_pairs" ? {} : ex.type === "type_translation" ? { text: "zzz" } : { choice: -1, tokens: ["zzz"] };

async function lessonExercises(lessonId: string) {
  const rows = await db.exercise.findMany({ where: { lessonId, status: "APPROVED" }, orderBy: { order: "asc" } });
  return rows.map((r) => ({ id: r.id, ex: parseExercise(r.type as ExerciseType, r.payload) }));
}

async function firstLessons() {
  const lessons = await db.lesson.findMany({
    orderBy: [{ skill: { unit: { order: "asc" } } }, { skill: { order: "asc" } }, { order: "asc" }],
    take: 3,
  });
  return lessons;
}

let user: User;
let n = 0;

beforeEach(async () => {
  user = await db.user.create({
    data: {
      email: `learner${Date.now()}-${n++}@test.local`,
      name: "Test Learner",
      passwordHash: "x",
      timezone: "Asia/Manila",
    },
  });
});

afterAll(async () => {
  await db.$disconnect();
});

async function playPerfect(lessonId: string, u: User = user) {
  const { attemptId } = await startAttempt(u, lessonId);
  for (const { id, ex } of await lessonExercises(lessonId)) await submitAnswer(u.id, attemptId, id, correctAnswer(ex));
  return { attemptId, result: await completeAttempt(u.id, attemptId) };
}

describe("lesson loop", () => {
  it("only lets a new learner start the very first lesson", async () => {
    const [first, second] = await firstLessons();
    await expect(getLessonForPlay(user.id, first.id)).resolves.toMatchObject({ id: first.id });
    await expect(startAttempt(user, second.id)).rejects.toMatchObject({ code: "locked" });
  });

  it("serves exercises without answers", async () => {
    const [first] = await firstLessons();
    const lesson = await getLessonForPlay(user.id, first.id);
    expect(lesson.exercises.length).toBeGreaterThanOrEqual(8);
    expect(JSON.stringify(lesson)).not.toMatch(/answerIndex|"answers"|distractors/);
  });

  it("awards XP, starts a streak and unlocks the next lesson after a perfect run", async () => {
    const [first, second] = await firstLessons();
    const { result } = await playPerfect(first.id);
    expect(result.xp.total).toBe(20); // base 10 + perfect 5 + first time 5
    expect(result).toMatchObject({ streak: 1, streakExtended: true, mistakes: 0, todayXp: 20 });

    const fresh = await db.user.findUniqueOrThrow({ where: { id: user.id } });
    expect(fresh.totalXp).toBe(20);
    const path = await getPathForUser(user.id);
    const lessons = path!.units[0].skills[0].lessons;
    expect(lessons.find((l) => l.id === first.id)?.state).toBe("complete");
    expect(lessons.find((l) => l.id === second.id)?.state).toBe("active");
  });

  it("charges a heart for a wrong answer and drops the perfect bonus", async () => {
    const [first] = await firstLessons();
    const { attemptId } = await startAttempt(user, first.id);
    const exercises = await lessonExercises(first.id);
    const target = exercises.find((e) => e.ex.type !== "match_pairs")!;
    const feedback = await submitAnswer(user.id, attemptId, target.id, wrongAnswer(target.ex));
    expect(feedback).toMatchObject({ correct: false, hearts: 4, outOfHearts: false });
    expect(feedback.nextHeartAt).not.toBeNull();

    for (const { id, ex } of exercises) await submitAnswer(user.id, attemptId, id, correctAnswer(ex));
    const result = await completeAttempt(user.id, attemptId);
    expect(result.xp.total).toBe(15); // base + first time, no perfect bonus
    expect(result.mistakes).toBe(1);
  });

  it("does not charge hearts for match-pairs", async () => {
    const [first] = await firstLessons();
    const { attemptId } = await startAttempt(user, first.id);
    const mp = (await lessonExercises(first.id)).find((e) => e.ex.type === "match_pairs")!;
    const feedback = await submitAnswer(user.id, attemptId, mp.id, {});
    expect(feedback).toMatchObject({ correct: false, hearts: 5 });
  });

  it("refuses to complete until every exercise is answered correctly", async () => {
    const [first] = await firstLessons();
    const { attemptId } = await startAttempt(user, first.id);
    const [one] = await lessonExercises(first.id);
    await submitAnswer(user.id, attemptId, one.id, correctAnswer(one.ex));
    await expect(completeAttempt(user.id, attemptId)).rejects.toMatchObject({ code: "incomplete" });
  });

  it("awards XP only once even if completion is submitted twice", async () => {
    const [first] = await firstLessons();
    const { attemptId } = await playPerfect(first.id);
    await expect(completeAttempt(user.id, attemptId)).rejects.toMatchObject({ code: "not_in_progress" });
    expect((await db.user.findUniqueOrThrow({ where: { id: user.id } })).totalXp).toBe(20);
    expect(await db.xpEvent.count({ where: { userId: user.id } })).toBe(1);
  });

  it("fails the attempt when the last heart is lost and blocks new lessons", async () => {
    await db.user.update({ where: { id: user.id }, data: { hearts: 1, heartsUpdatedAt: new Date() } });
    const u = await db.user.findUniqueOrThrow({ where: { id: user.id } });
    const [first] = await firstLessons();
    const { attemptId } = await startAttempt(u, first.id);
    const target = (await lessonExercises(first.id)).find((e) => e.ex.type !== "match_pairs")!;
    const feedback = await submitAnswer(u.id, attemptId, target.id, wrongAnswer(target.ex));
    expect(feedback).toMatchObject({ hearts: 0, outOfHearts: true });
    expect((await db.lessonAttempt.findUniqueOrThrow({ where: { id: attemptId } })).status).toBe("FAILED");
    await expect(submitAnswer(u.id, attemptId, target.id, correctAnswer(target.ex))).rejects.toMatchObject({
      code: "not_in_progress",
    });
    const drained = await db.user.findUniqueOrThrow({ where: { id: user.id } });
    await expect(startAttempt(drained, first.id)).rejects.toMatchObject({ code: "no_hearts" });
  });

  it("rejects answers for another learner's attempt", async () => {
    const [first] = await firstLessons();
    const { attemptId } = await startAttempt(user, first.id);
    const intruder = await db.user.create({
      data: { email: `intruder${Date.now()}@test.local`, name: "X", passwordHash: "x" },
    });
    const [one] = await lessonExercises(first.id);
    await expect(submitAnswer(intruder.id, attemptId, one.id, correctAnswer(one.ex))).rejects.toMatchObject({
      code: "not_in_progress",
    });
  });
});

describe("concurrency and content changes", () => {
  it("charges every heart when wrong answers arrive at the same time", async () => {
    await db.user.update({ where: { id: user.id }, data: { hearts: 2, heartsUpdatedAt: new Date() } });
    const u = await db.user.findUniqueOrThrow({ where: { id: user.id } });
    const [first] = await firstLessons();
    const a = await startAttempt(u, first.id);
    const b = await startAttempt(u, first.id);
    const target = (await lessonExercises(first.id)).find((e) => e.ex.type !== "match_pairs")!;
    await Promise.all([
      submitAnswer(u.id, a.attemptId, target.id, wrongAnswer(target.ex)),
      submitAnswer(u.id, b.attemptId, target.id, wrongAnswer(target.ex)),
    ]);
    expect((await db.user.findUniqueOrThrow({ where: { id: user.id } })).hearts).toBe(0);
  });

  it("awards the first-time bonus once when two attempts finish at the same time", async () => {
    const [first] = await firstLessons();
    const attempts = [await startAttempt(user, first.id), await startAttempt(user, first.id)];
    for (const { attemptId } of attempts)
      for (const { id, ex } of await lessonExercises(first.id)) await submitAnswer(user.id, attemptId, id, correctAnswer(ex));
    const results = await Promise.allSettled(attempts.map((a) => completeAttempt(user.id, a.attemptId)));
    expect(results.map((r) => r.status)).toEqual(["fulfilled", "fulfilled"]);
    // 20 (base + perfect + first time) + 15 (base + perfect)
    expect((await db.user.findUniqueOrThrow({ where: { id: user.id } })).totalXp).toBe(35);
  });

  it("lets a learner finish even if an exercise is approved while they're mid-lesson", async () => {
    const [first] = await firstLessons();
    const { attemptId } = await startAttempt(user, first.id);
    const original = await lessonExercises(first.id);
    const added = await db.exercise.create({
      data: {
        lessonId: first.id,
        order: 999,
        type: "type_translation",
        payload: { prompt: "salamat", promptLang: "tl", answers: ["thank you"] },
        status: "APPROVED",
        source: "HUMAN",
        reviewedAt: new Date(Date.now() + 1000),
      },
    });
    try {
      for (const { id, ex } of original) await submitAnswer(user.id, attemptId, id, correctAnswer(ex));
      await expect(completeAttempt(user.id, attemptId)).resolves.toMatchObject({ mistakes: 0 });
    } finally {
      await db.exercise.delete({ where: { id: added.id } });
    }
  });
});

describe("weekly leaderboard", () => {
  it("ranks learners by XP earned this week and includes the viewer", async () => {
    const [first] = await firstLessons();
    await playPerfect(first.id);
    const board = await getWeeklyLeaderboard(user.id);
    const me = board.rows.find((r) => r.isMe) ?? board.me;
    expect(me).toMatchObject({ xp: 20, name: "Test Learner" });
    const xps = board.rows.map((r) => r.xp);
    expect([...xps].sort((a, b) => b - a)).toEqual(xps);
  });
});
