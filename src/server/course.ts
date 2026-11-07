/**
 * Reads the course tree and decorates it with a learner's unlock state.
 */
import "server-only";
import type { Route } from "next";
import { db } from "@/lib/db";
import { buildPath, type LessonState, type SkillState } from "@/lib/game/path";

export type PathView = {
  courseTitle: string;
  units: {
    id: string;
    order: number;
    title: string;
    subtitle: string;
    color: string;
    skills: {
      id: string;
      slug: string;
      title: string;
      emoji: string;
      description: string;
      state: SkillState;
      completedLessons: number;
      totalLessons: number;
      nextLessonId: string | null;
      lessons: { id: string; title: string; state: LessonState }[];
    }[];
  }[];
};

const APPROVED = { where: { status: "APPROVED" as const } };

export async function getPathForUser(userId: string): Promise<PathView | null> {
  const [course, progress] = await Promise.all([
    db.course.findFirst({
      include: {
        units: {
          orderBy: { order: "asc" },
          include: {
            skills: {
              orderBy: { order: "asc" },
              include: {
                lessons: {
                  orderBy: { order: "asc" },
                  include: { _count: { select: { exercises: APPROVED } } },
                },
              },
            },
          },
        },
      },
    }),
    db.lessonProgress.findMany({ where: { userId }, select: { lessonId: true } }),
  ]);
  if (!course) return null;

  const skills = course.units.flatMap((u) => u.skills);
  const path = buildPath(
    skills.map((s) => ({ id: s.id, lessons: s.lessons.map((l) => ({ id: l.id, playable: l._count.exercises > 0 })) })),
    new Set(progress.map((p) => p.lessonId)),
  );
  const stateById = new Map(path.map((p) => [p.id, p]));

  return {
    courseTitle: course.title,
    units: course.units.map((u) => ({
      id: u.id,
      order: u.order,
      title: u.title,
      subtitle: u.subtitle,
      color: u.color,
      skills: u.skills.map((s) => {
        const p = stateById.get(s.id)!;
        return {
          id: s.id,
          slug: s.slug,
          title: s.title,
          emoji: s.emoji,
          description: s.description,
          state: p.state,
          completedLessons: p.completedLessons,
          totalLessons: p.totalLessons,
          nextLessonId: p.nextLessonId,
          lessons: s.lessons.map((l, i) => ({ id: l.id, title: l.title, state: p.lessons[i].state })),
        };
      }),
    })),
  };
}

/** Is `lessonId` open for this learner (active or already completed)? */
export async function canPlayLesson(userId: string, lessonId: string): Promise<boolean> {
  const path = await getPathForUser(userId);
  if (!path) return false;
  for (const unit of path.units)
    for (const skill of unit.skills)
      for (const lesson of skill.lessons) if (lesson.id === lessonId) return lesson.state !== "locked";
  return false;
}

/**
 * Where to send a learner to practise around `lessonId`: its skill if they've finished a lesson
 * there, else its unit, else the unit of their most recent progress. Null if they've finished
 * nothing yet (practice needs finished lessons).
 */
export async function practiceHrefFor(userId: string, lessonId: string): Promise<Route | null> {
  const lesson = await db.lesson.findUnique({ where: { id: lessonId }, include: { skill: true } });
  if (!lesson) return null;
  const done = (where: object) => db.lessonProgress.count({ where: { userId, lesson: where } });
  if (await done({ skillId: lesson.skillId })) return `/practice?skill=${lesson.skillId}` as Route;
  if (await done({ skill: { unitId: lesson.skill.unitId } })) return `/practice?unit=${lesson.skill.unitId}` as Route;
  const latest = await db.lessonProgress.findFirst({
    where: { userId },
    orderBy: { firstCompletedAt: "desc" },
    include: { lesson: { include: { skill: true } } },
  });
  return latest ? (`/practice?unit=${latest.lesson.skill.unitId}` as Route) : null;
}

export type SkillPageData = {
  id: string;
  slug: string;
  title: string;
  emoji: string;
  description: string;
  unitId: string;
  unitTitle: string;
  tips: string[];
  dialogues: { lesson: number; lines: [string, string, string][] }[];
  words: {
    tl: string;
    en: string;
    pos: string;
    notes: string | null;
    exampleTl: string | null;
    exampleEn: string | null;
    pic: string | null;
  }[];
  state: PathView["units"][number]["skills"][number]["state"];
  nextLessonId: string | null;
  completedLessons: number;
  totalLessons: number;
};

/** Everything the skill page shows: tips, word list (flashcards), dialogues and progress. */
export async function getSkillPage(userId: string, slug: string): Promise<SkillPageData | null> {
  const [skill, path] = await Promise.all([
    db.skill.findUnique({
      where: { slug },
      include: { unit: { select: { id: true, title: true } }, words: { orderBy: { id: "asc" } } },
    }),
    getPathForUser(userId),
  ]);
  if (!skill || !path) return null;
  const view = path.units.flatMap((u) => u.skills).find((s) => s.id === skill.id);
  if (!view) return null;
  return {
    id: skill.id,
    slug: skill.slug,
    title: skill.title,
    emoji: skill.emoji,
    description: skill.description,
    unitId: skill.unit.id,
    unitTitle: skill.unit.title,
    tips: skill.tips,
    // Conversations double as the answers to dialogue exercises, so only show the ones from
    // lessons the learner has already finished.
    dialogues: (Array.isArray(skill.dialogues) ? (skill.dialogues as SkillPageData["dialogues"]) : []).filter(
      (d) => view.lessons.filter((l) => l.state === "complete").length >= d.lesson,
    ),
    words: skill.words.map((w) => ({
      tl: w.tagalog,
      en: w.english,
      pos: w.partOfSpeech,
      notes: w.notes,
      exampleTl: w.exampleTl,
      exampleEn: w.exampleEn,
      pic: w.pic,
    })),
    state: view.state,
    nextLessonId: view.nextLessonId,
    completedLessons: view.completedLessons,
    totalLessons: view.totalLessons,
  };
}
