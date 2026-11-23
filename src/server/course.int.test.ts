import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import type { User } from "@/generated/prisma/client";
import { getPathForUser, getSkillPage } from "./course";

const SLUG = "t-course-";

// The shipped course may already teach patterns and have verb tables, so every assertion below looks
// only at the rows this file creates (all slugs, titles and roots start with SLUG).
const title = (name: string) => `${SLUG}Pattern ${name}`;
const mine = <T extends { root: string }>(tables: T[]) => tables.filter((t) => t.root.startsWith(SLUG));

let user: User;
let courseId: string;
let n = 0;

/** The first lesson of the course and its skill. */
async function firstLesson() {
  return db.lesson.findFirstOrThrow({
    orderBy: [{ skill: { unit: { order: "asc" } } }, { skill: { order: "asc" } }, { order: "asc" }],
    include: { skill: true },
  });
}

async function pattern(name: string, lessonId: string, order: number) {
  return db.grammarPattern.create({
    data: {
      courseId,
      slug: SLUG + name,
      order,
      title: title(name),
      lessonId,
      card: {
        rule: `Rule ${name}`,
        examples: [
          ["a", "b"],
          ["c", "d"],
        ],
        notes: [],
        mistakes: [],
      },
    },
  });
}

const forms = (stem: string) => ({
  infinitive: [stem],
  completed: [stem],
  incompleted: [stem],
  contemplated: [stem],
});

beforeAll(async () => {
  courseId = (await db.course.findFirstOrThrow()).id;
});

beforeEach(async () => {
  user = await db.user.create({
    data: { email: `course${Date.now()}-${n++}@test.local`, name: "Course Learner", passwordHash: "x" },
  });
});

afterEach(async () => {
  await db.grammarPattern.deleteMany({ where: { slug: { startsWith: SLUG } } });
  await db.exercise.deleteMany({ where: { id: { startsWith: SLUG } } });
  await db.verbTable.deleteMany({ where: { root: { startsWith: SLUG } } });
});

afterAll(async () => {
  await db.$disconnect();
});

describe("grammar on the path and the skill page", () => {
  it("lists the patterns each skill's lessons teach, in course order", async () => {
    const lesson = await firstLesson();
    await pattern("b", lesson.id, 902);
    await pattern("a", lesson.id, 901);

    const path = await getPathForUser(user.id);
    const skills = path!.units.flatMap((u) => u.skills);
    const ours = (s: (typeof skills)[number]) => s.patterns.filter((t) => t.startsWith(SLUG));
    expect(ours(skills.find((s) => s.id === lesson.skillId)!)).toEqual([title("a"), title("b")]);
    expect(skills.filter((s) => s.id !== lesson.skillId).every((s) => ours(s).length === 0)).toBe(true);
  });

  it("gives the skill page its patterns (cards only once unlocked) and the tables of its verb exercises", async () => {
    const lesson = await firstLesson();
    await pattern("open", lesson.id, 901);
    // The closed pattern lives in another skill; the page below is that skill's, not "any other".
    const elsewhereLesson = await db.lesson.findFirstOrThrow({
      where: { skillId: { not: lesson.skillId } },
      orderBy: [{ skill: { unit: { order: "asc" } } }, { skill: { order: "asc" } }, { order: "asc" }],
      include: { skill: true },
    });
    await pattern("closed", elsewhereLesson.id, 902);
    await db.lessonProgress.create({ data: { userId: user.id, lessonId: lesson.id } });

    const root = `${SLUG}root`;
    await db.verbTable.createMany({
      data: [
        { courseId, root, affix: "um", en: "used", forms: forms("x"), status: "APPROVED" },
        { courseId, root, affix: "mag", en: "used", forms: forms("y"), status: "APPROVED" },
        { courseId, root: `${SLUG}draft`, affix: "um", en: "draft", forms: forms("z") },
        { courseId, root: `${SLUG}other`, affix: "um", en: "other", forms: forms("w"), status: "APPROVED" },
      ],
    });
    const exercise = (id: string, type: "conjugate" | "paradigm" | "find_root", r: string, status = "APPROVED") =>
      db.exercise.create({
        data: {
          id: SLUG + id,
          lessonId: lesson.id,
          order: 900,
          type,
          payload: { root: r },
          status: status as "APPROVED",
          source: "HUMAN",
        },
      });
    await exercise("c", "conjugate", root);
    await exercise("p", "paradigm", root);
    await exercise("f", "find_root", `${SLUG}draft`);
    await exercise("pending", "conjugate", `${SLUG}other`, "DRAFT");

    const page = await getSkillPage(user.id, lesson.skill.slug);
    // Only this skill's pattern appears, with its card since the lesson is finished.
    expect(page!.patterns.filter((p) => p.slug.startsWith(SLUG))).toEqual([
      expect.objectContaining({
        slug: `${SLUG}open`,
        title: title("open"),
        unlocked: true,
        card: expect.objectContaining({ rule: "Rule open" }),
      }),
    ]);
    // Approved tables of the roots in approved verb exercises: not drafts, not other roots.
    expect(mine(page!.verbTables).map((t) => [t.root, t.affix])).toEqual([
      [root, "um"],
      [root, "mag"],
    ]);

    const elsewhere = await getSkillPage(user.id, elsewhereLesson.skill.slug);
    const closed = elsewhere!.patterns.filter((p) => p.slug.startsWith(SLUG));
    expect(closed.map((p) => p.slug)).toEqual([`${SLUG}closed`]);
    expect(closed[0]).toMatchObject({ unlocked: false, card: null });
    expect(elsewhere!.verbTables).toEqual([]);
  });

  it("withholds a verb's table until a finished lesson of the skill drills it", async () => {
    const first = await firstLesson();
    const later = await db.lesson.findFirstOrThrow({
      where: { skillId: first.skillId, id: { not: first.id } },
      orderBy: { order: "asc" },
    });
    const early = `${SLUG}early`;
    const late = `${SLUG}late`;
    await db.verbTable.createMany({
      data: [early, late].map((root) => ({
        courseId,
        root,
        affix: "um" as const,
        en: root,
        forms: forms(root),
        status: "APPROVED" as const,
      })),
    });
    for (const [lessonId, root] of [
      [first.id, early],
      [later.id, late],
    ])
      await db.exercise.create({
        data: {
          id: `${SLUG}ex-${root}`,
          lessonId,
          order: 900,
          type: "conjugate",
          payload: { root },
          status: "APPROVED",
          source: "HUMAN",
        },
      });

    // The tables are the answers to the drills, so nothing shows before the learner has played them.
    const rootsShown = async () => mine((await getSkillPage(user.id, first.skill.slug))!.verbTables).map((t) => t.root);
    expect(await rootsShown()).toEqual([]);

    await db.lessonProgress.create({ data: { userId: user.id, lessonId: first.id } });
    expect(await rootsShown()).toEqual([early]);

    await db.lessonProgress.create({ data: { userId: user.id, lessonId: later.id } });
    expect((await rootsShown()).sort()).toEqual([early, late].sort());
  });
});
