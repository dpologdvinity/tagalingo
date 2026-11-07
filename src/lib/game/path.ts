/**
 * Skill-path unlock rules.
 *
 * - Skills unlock strictly in order: a skill becomes active only when every lesson of every
 *   earlier skill is complete.
 * - Inside a skill, lessons unlock in order.
 * - A skill with any lesson lacking approved exercises is "coming_soon" and blocks the path
 *   (content is still in review), so learners never hit an empty lesson.
 */

export type PathSkillInput = {
  id: string;
  lessons: { id: string; /** has at least one APPROVED exercise */ playable: boolean }[];
};

export type LessonState = "complete" | "active" | "locked";
export type SkillState = "complete" | "active" | "locked" | "coming_soon";

export type PathSkill = {
  id: string;
  state: SkillState;
  completedLessons: number;
  totalLessons: number;
  /** Lesson to open when the node is tapped (first incomplete, or the first lesson to replay). */
  nextLessonId: string | null;
  lessons: { id: string; state: LessonState }[];
};

export function buildPath(skills: PathSkillInput[], completed: ReadonlySet<string>): PathSkill[] {
  let gateOpen = true; // false once we pass the first skill that isn't fully complete
  return skills.map((skill) => {
    const playable = skill.lessons.length > 0 && skill.lessons.every((l) => l.playable);
    const doneCount = skill.lessons.filter((l) => completed.has(l.id)).length;
    const allDone = playable && doneCount === skill.lessons.length;

    let state: SkillState;
    if (!playable) state = gateOpen ? "coming_soon" : "locked";
    else if (!gateOpen) state = "locked";
    else state = allDone ? "complete" : "active";

    // Within an active skill, lessons unlock sequentially from the first incomplete one.
    let firstIncompleteSeen = false;
    const lessons = skill.lessons.map((l) => {
      let ls: LessonState = "locked";
      if (state === "complete") ls = "complete";
      else if (state === "active") {
        if (completed.has(l.id) && !firstIncompleteSeen) ls = "complete";
        else if (!firstIncompleteSeen) {
          ls = "active";
          firstIncompleteSeen = true;
        }
      }
      return { id: l.id, state: ls };
    });

    const nextLessonId =
      state === "active"
        ? (lessons.find((l) => l.state === "active")?.id ?? null)
        : state === "complete"
          ? (skill.lessons[0]?.id ?? null)
          : null;

    if (state !== "complete") gateOpen = false;

    return {
      id: skill.id,
      state,
      completedLessons: state === "locked" || state === "coming_soon" ? 0 : doneCount,
      totalLessons: skill.lessons.length,
      nextLessonId,
      lessons,
    };
  });
}
