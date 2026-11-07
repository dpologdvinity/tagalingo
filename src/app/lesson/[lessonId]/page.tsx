/** Full-screen lesson. Locked lessons bounce back to the path. */
import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { getLearnerStats } from "@/server/learner";
import { getLessonForPlay, LessonError, type LessonForPlay } from "@/server/lessons";
import { requireUser } from "@/server/session";
import { LessonPlayer } from "./lesson-player";

export const metadata: Metadata = { title: "Lesson" };

export default async function LessonPage({ params }: PageProps<"/lesson/[lessonId]">) {
  const { lessonId } = await params;
  const user = await requireUser();
  let lesson: LessonForPlay;
  try {
    lesson = await getLessonForPlay(user.id, lessonId);
  } catch (e) {
    if (e instanceof LessonError && e.code === "locked") redirect("/learn");
    if (e instanceof LessonError) notFound();
    throw e;
  }
  const stats = await getLearnerStats(user);
  return <LessonPlayer lesson={lesson} hearts={stats.hearts} nextHeartAt={stats.nextHeartAt} />;
}
