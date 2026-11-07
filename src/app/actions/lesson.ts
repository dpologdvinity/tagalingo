"use server";
/**
 * Lesson server actions, called by the lesson player. They validate their inputs, re-check the
 * session, and return a typed result instead of throwing so the client can show a clear message.
 */
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { getCurrentUser } from "@/server/session";
import {
  completeAttempt,
  LessonError,
  startAttempt,
  submitAnswer,
  type AnswerFeedback,
  type LessonResult,
} from "@/server/lessons";

export type ActionResult<T> = { ok: true; data: T } | { ok: false; code: string; message: string };

const id = z.string().min(1).max(64);

async function run<T>(fn: () => Promise<T>): Promise<ActionResult<T>> {
  try {
    return { ok: true, data: await fn() };
  } catch (e) {
    if (e instanceof LessonError) return { ok: false, code: e.code, message: e.message };
    console.error(e);
    return { ok: false, code: "server_error", message: "Something went wrong saving your progress. Try again." };
  }
}

async function userOrError() {
  const user = await getCurrentUser();
  if (!user) throw new LessonError("not_found", "Your session has ended. Log in again to keep playing.");
  return user;
}

export async function startLessonAction(lessonId: string): Promise<ActionResult<{ attemptId: string }>> {
  return run(async () => startAttempt(await userOrError(), id.parse(lessonId)));
}

export async function answerAction(
  attemptId: string,
  exerciseId: string,
  answer: unknown,
): Promise<ActionResult<AnswerFeedback>> {
  return run(async () => {
    const user = await userOrError();
    // Answers are tiny; refuse anything suspiciously large before touching the database.
    if (JSON.stringify(answer ?? null).length > 4000) throw new LessonError("not_found", "Answer is too long");
    return submitAnswer(user.id, id.parse(attemptId), id.parse(exerciseId), answer);
  });
}

export async function completeLessonAction(attemptId: string): Promise<ActionResult<LessonResult>> {
  const result = await run(async () => completeAttempt((await userOrError()).id, id.parse(attemptId)));
  if (result.ok) revalidatePath("/", "layout"); // path, stats and league all changed
  return result;
}
