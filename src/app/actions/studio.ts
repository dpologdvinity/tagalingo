"use server";
/**
 * Studio server actions: generate drafts, edit, approve and reject exercises and verb tables, flag
 * grammar cards and tag exercises with patterns. Reviewer-only; every action re-checks the role.
 * The verb-table, flag and tag actions are thin: they check the role, call the matching function in
 * `server/studio.ts` and revalidate the pages that show the result.
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
import {
  flagCard,
  resolveFlag,
  reviewVerbTable,
  saveVerbTable,
  setExercisePatterns,
  type StudioResult,
} from "@/server/studio";
import { canReview } from "@/lib/roles";

export type { StudioResult };

async function reviewer() {
  const user = await getCurrentUser();
  if (!user || !canReview(user)) throw new Error("Only reviewers can change course content.");
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

/**
 * Run a reviewer-only write. The role is checked first, so a learner is refused whatever they send;
 * then `input` (the action's arguments, which a client can make anything) is validated against
 * `schema`. A refusal, bad input or unexpected failure comes back as a `StudioResult`, never as raw
 * error text from a TypeError. `write` returns the extra paths to revalidate (besides /studio).
 */
async function asReviewer<S extends z.ZodType>(
  schema: S,
  input: unknown,
  write: (user: Awaited<ReturnType<typeof reviewer>>, args: z.infer<S>) => Promise<StudioResult & { paths?: string[] }>,
  failure: string,
): Promise<StudioResult> {
  try {
    const user = await reviewer();
    const args = schema.safeParse(input);
    if (!args.success) return { ok: false, message: "That request was not valid." };
    const { paths = [], ...result } = await write(user, args.data);
    if (result.ok) for (const p of ["/studio", ...paths]) revalidatePath(p);
    return result;
  } catch (e) {
    return { ok: false, message: e instanceof Error ? e.message : failure };
  }
}

const id = z.string().min(1);

export async function saveVerbTableAction(tableId: string, formsJson: string): Promise<StudioResult> {
  return asReviewer(
    z.tuple([id, z.string()]),
    [tableId, formsJson],
    async (user, [tid, json]) => ({
      ...(await saveVerbTable(loadCourseFile(COURSE_FILE), user.id, tid, json)),
      paths: ["/studio/verbs"],
    }),
    "Save failed.",
  );
}

export async function reviewVerbTableAction(tableId: string, status: string, note?: string): Promise<StudioResult> {
  return asReviewer(
    z.tuple([id, z.string(), z.string().optional()]),
    [tableId, status, note],
    async (user, [tid, st, n]) => ({ ...(await reviewVerbTable(user.id, tid, st, n)), paths: ["/studio/verbs"] }),
    "Update failed.",
  );
}

export async function flagCardAction(patternSlug: string, note: string): Promise<StudioResult> {
  return asReviewer(
    z.tuple([id, z.string()]),
    [patternSlug, note],
    async (user, [slug, n]) => ({ ...(await flagCard(user.id, slug, n)), paths: ["/studio/grammar"] }),
    "Couldn’t flag the card.",
  );
}

export async function resolveFlagAction(flagId: string): Promise<StudioResult> {
  return asReviewer(
    z.tuple([id]),
    [flagId],
    async (_user, [fid]) => ({ ...(await resolveFlag(fid)), paths: ["/studio/grammar"] }),
    "Couldn’t resolve the flag.",
  );
}

export async function setExercisePatternsAction(exerciseId: string, slugs: string[]): Promise<StudioResult> {
  return asReviewer(
    z.tuple([id, z.array(z.string())]),
    [exerciseId, slugs],
    async (_user, [eid, wanted]) => {
      // Looked up before the write, so a failure here can never report a save that went through.
      const skillPath = await skillPathFor(eid).catch(() => null);
      const result = await setExercisePatterns(eid, wanted);
      return { ...result, paths: ["/studio/grammar", ...(skillPath ? [skillPath] : [])] };
    },
    "Couldn’t save the patterns.",
  );
}
