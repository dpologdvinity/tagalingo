/** Full-screen lesson. Locked lessons bounce back to the path. */
import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { LessonPlayer } from "@/components/player/lesson-player";
import { practiceHrefFor } from "@/server/course";
import { getLearnerStats } from "@/server/learner";
import { getLessonInfo, LessonError } from "@/server/lessons";
import { requireUser } from "@/server/session";

export const metadata: Metadata = { title: "Lesson" };

export default async function LessonPage({ params }: PageProps<"/lesson/[lessonId]">) {
  const { lessonId } = await params;
  const user = await requireUser();
  try {
    await getLessonInfo(user.id, lessonId);
  } catch (e) {
    if (e instanceof LessonError && e.code === "locked") redirect("/learn");
    if (e instanceof LessonError) notFound();
    throw e;
  }
  const [stats, practiceHref] = await Promise.all([getLearnerStats(user), practiceHrefFor(user.id, lessonId)]);
  return (
    <LessonPlayer
      session={{ kind: "lesson", lessonId }}
      practiceHref={practiceHref}
      hearts={stats.hearts}
      nextHeartAt={stats.nextHeartAt}
    />
  );
}
