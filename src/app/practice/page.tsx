/**
 * Practice session: /practice?skill=<id> or /practice?unit=<id>. Reviews finished lessons,
 * works with zero hearts and wins one back. The server picks the exercises.
 */
import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { LessonPlayer } from "@/components/player/lesson-player";
import { getLearnerStats } from "@/server/learner";
import { requireUser } from "@/server/session";

export const metadata: Metadata = { title: "Practice" };

export default async function PracticePage({ searchParams }: PageProps<"/practice">) {
  const sp = await searchParams;
  const skillId = typeof sp.skill === "string" ? sp.skill : null;
  const unitId = typeof sp.unit === "string" ? sp.unit : null;
  if (!skillId && !unitId) redirect("/learn");
  const user = await requireUser();
  const stats = await getLearnerStats(user);
  return (
    <LessonPlayer
      session={{ kind: "practice", scope: skillId ? { skillId } : { unitId: unitId! } }}
      hearts={stats.hearts}
      nextHeartAt={stats.nextHeartAt}
    />
  );
}
