"use server";
/**
 * Studio server actions: generate drafts, edit, approve and reject exercises. Reviewer-only;
 * every action re-checks the role.
 */
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { db } from "@/lib/db";
import { loadCourseFile } from "@/lib/content/course";
import { selectGenerator } from "@/lib/content/generators";
import { COURSE_FILE } from "@/lib/content/paths";
import { generateDraftsForLesson } from "@/lib/content/persist";
import { ExerciseValidationError, parseExercise, type ExerciseType } from "@/lib/content/schema";
import { getCurrentUser } from "@/server/session";

export type StudioResult = { ok: true; message: string } | { ok: false; message: string };

async function reviewer() {
  const user = await getCurrentUser();
  if (!user?.isReviewer) throw new Error("Only reviewers can change course content.");
  return user;
}

async function skillPathFor(exerciseId: string) {
  const ex = await db.exercise.findUniqueOrThrow({
    where: { id: exerciseId },
    select: { lesson: { select: { skillId: true } } },
  });
  return `/studio/skills/${ex.lesson.skillId}`;
}

function revalidateContent(skillPath: string) {
  revalidatePath(skillPath);
  revalidatePath("/studio");
  revalidatePath("/learn");
}

export async function generateDraftsAction(skillId: string, lessonOrder: number): Promise<StudioResult> {
  try {
    const user = await reviewer();
    const skill = await db.skill.findUniqueOrThrow({ where: { id: skillId } });
    const generator = selectGenerator();
    const result = await generateDraftsForLesson(
      db,
      generator,
      loadCourseFile(COURSE_FILE),
      { skillSlug: skill.slug, lessonOrder },
      user.id,
    );
    revalidateContent(`/studio/skills/${skillId}`);
    const rejected = result.rejected ? ` ${result.rejected} failed validation and were skipped.` : "";
    return {
      ok: true,
      message: `Generated ${result.created} drafts with ${generator.provider === "claude" ? "Claude" : "the offline stub"}.${rejected}`,
    };
  } catch (e) {
    return { ok: false, message: e instanceof Error ? e.message : "Generation failed." };
  }
}

const statusSchema = z.enum(["APPROVED", "REJECTED", "DRAFT"]);

export async function reviewExerciseAction(exerciseId: string, status: string, note?: string): Promise<StudioResult> {
  try {
    const user = await reviewer();
    const next = statusSchema.parse(status);
    const row = await db.exercise.findUniqueOrThrow({ where: { id: exerciseId } });
    if (next === "APPROVED") parseExercise(row.type as ExerciseType, row.payload); // never approve invalid content
    await db.exercise.update({
      where: { id: exerciseId },
      data: {
        status: next,
        reviewedById: user.id,
        reviewedAt: new Date(),
        reviewNote: note?.trim() ? note.trim().slice(0, 500) : row.reviewNote,
      },
    });
    revalidateContent(await skillPathFor(exerciseId));
    return {
      ok: true,
      message: next === "APPROVED" ? "Approved." : next === "REJECTED" ? "Rejected." : "Moved back to drafts.",
    };
  } catch (e) {
    return {
      ok: false,
      message: e instanceof ExerciseValidationError ? e.message : e instanceof Error ? e.message : "Update failed.",
    };
  }
}

export async function saveExerciseAction(exerciseId: string, payloadJson: string): Promise<StudioResult> {
  try {
    const user = await reviewer();
    let payload: unknown;
    try {
      payload = JSON.parse(payloadJson);
    } catch {
      return { ok: false, message: "That isn’t valid JSON. Check for a missing comma or quote." };
    }
    const row = await db.exercise.findUniqueOrThrow({ where: { id: exerciseId } });
    const parsed = parseExercise(row.type as ExerciseType, payload);
    await db.exercise.update({
      where: { id: exerciseId },
      data: {
        payload: parsed.payload,
        reviewedById: user.id,
        reviewedAt: new Date(),
      },
    });
    revalidateContent(await skillPathFor(exerciseId));
    return { ok: true, message: "Saved." };
  } catch (e) {
    return { ok: false, message: e instanceof Error ? e.message : "Save failed." };
  }
}
