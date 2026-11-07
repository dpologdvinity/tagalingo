"use server";
/** Profile settings: display name, daily XP goal, timezone. */
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { db } from "@/lib/db";
import { DAILY_GOALS } from "@/lib/game/goals";
import { getCurrentUser } from "@/server/session";

export type SettingsState = { ok?: boolean; error?: string } | undefined;

const schema = z.object({
  name: z.string().trim().min(1, "Your name can’t be empty.").max(40, "Keep your name under 40 characters."),
  dailyGoalXp: z.coerce.number().refine((n) => DAILY_GOALS.some((g) => g.xp === n), "Pick one of the goals."),
  timezone: z.string().refine((tz) => {
    try {
      new Intl.DateTimeFormat("en", { timeZone: tz });
      return true;
    } catch {
      return false;
    }
  }, "Pick a valid timezone."),
});

export async function updateSettingsAction(_: SettingsState, form: FormData): Promise<SettingsState> {
  const user = await getCurrentUser();
  if (!user) return { error: "Your session has ended. Log in again." };
  const parsed = schema.safeParse(Object.fromEntries(form));
  if (!parsed.success) return { error: parsed.error.issues[0].message };
  await db.user.update({ where: { id: user.id }, data: parsed.data });
  revalidatePath("/", "layout");
  return { ok: true };
}
