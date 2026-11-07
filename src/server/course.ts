/**
 * Reads the course tree and decorates it with a learner's unlock state.
 */
import "server-only";
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
