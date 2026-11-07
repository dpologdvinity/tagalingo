import { describe, expect, it } from "vitest";
import { buildPath, type PathSkillInput } from "./path";

const skills: PathSkillInput[] = [
  { id: "s1", lessons: [{ id: "l1", playable: true }, { id: "l2", playable: true }] },
  { id: "s2", lessons: [{ id: "l3", playable: true }, { id: "l4", playable: true }] },
  { id: "s3", lessons: [{ id: "l5", playable: false }] },
];

describe("buildPath", () => {
  it("unlocks only the very first lesson for a brand new learner", () => {
    const path = buildPath(skills, new Set());
    expect(path[0]).toMatchObject({ state: "active", nextLessonId: "l1", completedLessons: 0 });
    expect(path[1].state).toBe("locked");
    expect(path[0].lessons.map((l) => l.state)).toEqual(["active", "locked"]);
  });

  it("moves to the next lesson inside a skill", () => {
    const path = buildPath(skills, new Set(["l1"]));
    expect(path[0]).toMatchObject({ state: "active", nextLessonId: "l2", completedLessons: 1 });
  });

  it("unlocks the next skill once every lesson of the previous skill is complete", () => {
    const path = buildPath(skills, new Set(["l1", "l2"]));
    expect(path[0].state).toBe("complete");
    expect(path[1]).toMatchObject({ state: "active", nextLessonId: "l3" });
  });

  it("marks skills without approved content as coming soon and stops the path there", () => {
    const path = buildPath(skills, new Set(["l1", "l2", "l3", "l4"]));
    expect(path[1].state).toBe("complete");
    expect(path[2].state).toBe("coming_soon");
  });

  it("lets a completed skill be replayed", () => {
    const path = buildPath(skills, new Set(["l1", "l2"]));
    expect(path[0].lessons.every((l) => l.state === "complete")).toBe(true);
    expect(path[0].nextLessonId).toBe("l1");
  });

  it("does not unlock later skills just because their lessons were completed out of order", () => {
    // e.g. content was re-ordered after a learner finished l3.
    const path = buildPath(skills, new Set(["l3"]));
    expect(path[1].state).toBe("locked");
  });
});
