/**
 * Practice session: /practice?skill=<id>, ?unit=<id>, ?pattern=<grammar pattern slug> or
 * ?weak=grammar (the learner's weakest patterns). Reviews finished lessons, works with zero hearts
 * and wins one back. The server picks the exercises.
 */
import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { LessonPlayer } from "@/components/player/lesson-player";
import { getLearnerStats } from "@/server/learner";
import type { PracticeScope } from "@/server/lessons";
import { requireUser } from "@/server/session";

export const metadata: Metadata = { title: "Practice" };

/** The practice scope named by the query string, or null when it names none. */
function scopeOf(sp: Record<string, string | string[] | undefined>): PracticeScope | null {
  if (typeof sp.skill === "string") return { skillId: sp.skill };
  if (typeof sp.unit === "string") return { unitId: sp.unit };
  if (typeof sp.pattern === "string") return { patternSlug: sp.pattern };
  if (sp.weak === "grammar") return { weakGrammar: true };
  return null;
}

export default async function PracticePage({ searchParams }: PageProps<"/practice">) {
  const sp = await searchParams;
  const scope = scopeOf(sp);
  if (!scope) redirect("/learn");
  const user = await requireUser();
  const stats = await getLearnerStats(user);
  return <LessonPlayer session={{ kind: "practice", scope }} hearts={stats.hearts} nextHeartAt={stats.nextHeartAt} />;
}
