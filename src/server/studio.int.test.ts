import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { db } from "@/lib/db";
import { loadCourseFile, type CourseDefinition } from "@/lib/content/course";
import { COURSE_FILE } from "@/lib/content/paths";
import { conjugate } from "@/lib/grammar/morphology";
import type { VerbEntry } from "@/lib/grammar/types";
import type { User } from "@/generated/prisma/client";
import {
  flagCard,
  getGrammarForReview,
  getSkillForReview,
  getVerbTablesForReview,
  resolveFlag,
  reviewVerbTable,
  saveVerbTable,
  setExercisePatterns,
} from "./studio";

// The one test that drives a real server action needs a session and a no-op cache.
const session = vi.hoisted(() => ({ user: null as unknown }));
vi.mock("@/server/session", () => ({ getCurrentUser: async () => session.user }));
vi.mock("next/cache", () => ({ revalidatePath: () => undefined }));

const P = "t-studio-";
let n = 0;
let courseId: string;
let reviewer: User;

const verb: VerbEntry = { root: "tstudio", en: "to test", affixes: ["um"], glottal: false, stem: null, forms: {} };

/** The shipped course with `verb` listed under its first skill, so saves have a rule to diff against. */
function courseWith(entry: VerbEntry): CourseDefinition {
  const shipped = loadCourseFile(COURSE_FILE);
  return {
    ...shipped,
    units: shipped.units.map((u, ui) => ({
      ...u,
      skills: u.skills.map((s, si) => (ui === 0 && si === 0 ? { ...s, verbs: [entry] } : s)),
    })),
  };
}
const def = courseWith(verb);
const ruleForms = conjugate(verb, "um");

const table = (over: { root?: string; affix?: "um" | "mag"; status?: "DRAFT" | "APPROVED" | "REJECTED" } = {}) =>
  db.verbTable.create({
    data: {
      id: `${P}table-${n++}`,
      courseId,
      root: over.root ?? verb.root,
      affix: over.affix ?? "um",
      en: verb.en,
      forms: ruleForms,
      status: over.status ?? "DRAFT",
      reviewNote: "old note",
    },
  });

async function pattern(slug: string, order = 9000) {
  const lesson = await db.lesson.findFirstOrThrow({ orderBy: [{ skillId: "asc" }, { order: "asc" }] });
  return db.grammarPattern.create({
    data: {
      id: P + slug,
      courseId,
      slug: P + slug,
      order,
      title: `Pattern ${slug}`,
      lessonId: lesson.id,
      card: {
        rule: "A rule",
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

beforeAll(async () => {
  courseId = (await db.course.findFirstOrThrow()).id;
});

beforeEach(async () => {
  reviewer = await db.user.create({
    data: {
      id: `${P}user-${n++}`,
      email: `studio${Date.now()}-${n}@test.local`,
      name: "Rev Iewer",
      passwordHash: "x",
      isReviewer: true,
    },
  });
  session.user = reviewer;
});

afterEach(async () => {
  await db.exercise.deleteMany({ where: { id: { startsWith: P } } });
  await db.verbTable.deleteMany({ where: { id: { startsWith: P } } });
  await db.grammarPattern.deleteMany({ where: { slug: { startsWith: P } } });
  await db.user.deleteMany({ where: { id: { startsWith: P } } });
});

afterAll(async () => {
  await db.$disconnect();
});

describe("saveVerbTable", () => {
  it("stores the forms with no irregular cells when they match the rule", async () => {
    const t = await table();
    const result = await saveVerbTable(def, reviewer.id, t.id, JSON.stringify(ruleForms));
    expect(result).toEqual({ ok: true, message: "Saved." });
    const row = await db.verbTable.findUniqueOrThrow({ where: { id: t.id } });
    expect(row.irregular).toEqual([]);
    expect(row.reviewedById).toBe(reviewer.id);
    expect(row.status).toBe("DRAFT"); // saving never changes the status
  });

  it("marks an edited cell as irregular", async () => {
    const t = await table();
    const edited = { ...ruleForms, incompleted: ["kumakaen", ...ruleForms.incompleted] };
    expect((await saveVerbTable(def, reviewer.id, t.id, JSON.stringify(edited))).ok).toBe(true);
    const row = await db.verbTable.findUniqueOrThrow({ where: { id: t.id } });
    expect(row.irregular).toEqual(["incompleted"]);
    expect(row.forms).toEqual(edited);
  });

  it("rejects malformed JSON and an empty cell without touching the row", async () => {
    const t = await table();
    const bad = await saveVerbTable(def, reviewer.id, t.id, "{not json");
    expect(bad.ok).toBe(false);
    const empty = await saveVerbTable(def, reviewer.id, t.id, JSON.stringify({ ...ruleForms, completed: [] }));
    expect(empty).toMatchObject({ ok: false });
    expect(empty.message).toContain("completed");
    expect((await db.verbTable.findUniqueOrThrow({ where: { id: t.id } })).reviewedById).toBeNull();
  });

  it("rejects a root or affix that course.yaml does not list", async () => {
    const stray = await table({ root: "tstudiostray" });
    expect(await saveVerbTable(def, reviewer.id, stray.id, JSON.stringify(ruleForms))).toEqual({
      ok: false,
      message: expect.stringContaining("tstudiostray"),
    });
    const noAffix = await table({ affix: "mag" });
    const res = await saveVerbTable(def, reviewer.id, noAffix.id, JSON.stringify(ruleForms));
    expect(res.ok).toBe(false);
    expect(res.message).toContain("mag");
  });
});

describe("reviewVerbTable", () => {
  it("approves with the reviewer and note, and an empty note keeps the old one", async () => {
    const t = await table();
    expect((await reviewVerbTable(reviewer.id, t.id, "APPROVED", "  looks right ")).ok).toBe(true);
    let row = await db.verbTable.findUniqueOrThrow({ where: { id: t.id } });
    expect(row).toMatchObject({ status: "APPROVED", reviewedById: reviewer.id, reviewNote: "looks right" });
    expect(row.reviewedAt).not.toBeNull();

    expect((await reviewVerbTable(reviewer.id, t.id, "REJECTED", "  ")).ok).toBe(true);
    row = await db.verbTable.findUniqueOrThrow({ where: { id: t.id } });
    expect(row).toMatchObject({ status: "REJECTED", reviewNote: "looks right" });
  });

  it("will not approve a table whose forms are no longer valid", async () => {
    const t = await table();
    await db.verbTable.update({ where: { id: t.id }, data: { forms: { infinitive: [] } } });
    const res = await reviewVerbTable(reviewer.id, t.id, "APPROVED");
    expect(res.ok).toBe(false);
    expect((await db.verbTable.findUniqueOrThrow({ where: { id: t.id } })).status).toBe("DRAFT");
  });

  it("lists tables by root then affix, filtered by status, and flags a broken row instead of throwing", async () => {
    const a = await table({ status: "DRAFT" });
    const b = await table({ affix: "mag", status: "APPROVED" });
    const broken = await table({ root: "tstudiobroken" });
    await db.verbTable.update({ where: { id: broken.id }, data: { forms: { nope: 1 } } });

    const mine = (rows: { id: string }[]) => rows.filter((r) => r.id.startsWith(P)).map((r) => r.id);
    expect(mine(await getVerbTablesForReview())).toEqual([a.id, b.id, broken.id]);
    expect(mine(await getVerbTablesForReview("APPROVED"))).toEqual([b.id]);
    const rows = await getVerbTablesForReview("DRAFT");
    expect(rows.find((r) => r.id === a.id)?.forms).toEqual(ruleForms);
    expect(rows.find((r) => r.id === broken.id)).toMatchObject({ forms: null, formsError: expect.any(String) });
  });
});

/** A conjugate drill on the fixture verb, stored APPROVED in the first lesson of the first skill. */
async function verbDrill(answers: string[], status: "DRAFT" | "APPROVED" = "APPROVED") {
  const lesson = await db.lesson.findFirstOrThrow({ orderBy: [{ skillId: "asc" }, { order: "asc" }] });
  return db.exercise.create({
    data: {
      id: `${P}drill-${n++}`,
      lessonId: lesson.id,
      order: 9000,
      type: "conjugate",
      status,
      source: "HUMAN",
      payload: {
        sentence: "___ ako kahapon.",
        translation: "I tested yesterday.",
        root: verb.root,
        affix: "um",
        form: "completed",
        answers,
      },
    },
  });
}

describe("verb drills against approved tables", () => {
  const warningsOf = async (lessonId: string, exerciseId: string) => {
    const { skillId } = await db.lesson.findUniqueOrThrow({ where: { id: lessonId }, select: { skillId: true } });
    const skill = await getSkillForReview(skillId);
    return skill!.lessons.flatMap((l) => l.exercises).find((e) => e.id === exerciseId)!.warnings;
  };

  it("warns on the review page when the table is missing, not approved, or no longer has the answer", async () => {
    const drill = await verbDrill([ruleForms.completed[0]]);
    expect((await warningsOf(drill.lessonId, drill.id)).join(" ")).toMatch(/no approved table/i);

    const t = await table({ status: "DRAFT" });
    expect((await warningsOf(drill.lessonId, drill.id)).join(" ")).toMatch(/no approved table/i);

    await reviewVerbTable(reviewer.id, t.id, "APPROVED");
    expect(await warningsOf(drill.lessonId, drill.id)).toEqual([]);

    const edited = { ...ruleForms, completed: ["tinumestuhan"] };
    expect((await saveVerbTable(def, reviewer.id, t.id, JSON.stringify(edited))).ok).toBe(true);
    expect((await warningsOf(drill.lessonId, drill.id)).join(" ")).toMatch(/not in the approved completed form/);

    await reviewVerbTable(reviewer.id, t.id, "REJECTED");
    expect((await warningsOf(drill.lessonId, drill.id)).join(" ")).toMatch(/no approved table/i);
  });

  it("says how many approved drills use a table when it is saved or rejected", async () => {
    const t = await table({ status: "APPROVED" });
    await verbDrill([ruleForms.completed[0]]);
    await verbDrill([ruleForms.completed[0]], "DRAFT"); // drafts are not counted
    const saved = await saveVerbTable(def, reviewer.id, t.id, JSON.stringify(ruleForms));
    expect(saved.message).toMatch(/1 approved drill uses this table/);
    const rejected = await reviewVerbTable(reviewer.id, t.id, "REJECTED");
    expect(rejected.message).toMatch(/1 approved drill uses this table/);
    // A table that is not approved has no live drills to warn about.
    expect((await reviewVerbTable(reviewer.id, t.id, "DRAFT")).message).toBe("Moved back to drafts.");
  });
});

describe("card flags", () => {
  it("creates a flag, lists it as open, then resolves it", async () => {
    const p = await pattern("flags");
    expect((await flagCard(reviewer.id, p.slug, "  The table is missing the future  ")).ok).toBe(true);

    const find = async () => (await getGrammarForReview()).find((g) => g.slug === p.slug)!;
    let item = await find();
    expect(item.flags).toHaveLength(1);
    expect(item.flags[0]).toMatchObject({ note: "The table is missing the future", by: "Rev Iewer", resolvedAt: null });

    const flagId = item.flags[0].id;
    expect((await resolveFlag(flagId)).ok).toBe(true);
    item = await find();
    expect(item.flags[0].resolvedAt).toBeInstanceOf(Date);
    const resolvedAt = item.flags[0].resolvedAt;

    expect((await resolveFlag(flagId)).ok).toBe(true); // already resolved: a no-op
    expect((await find()).flags[0].resolvedAt).toEqual(resolvedAt);
  });

  it("rejects an unknown pattern and an empty or overlong note", async () => {
    const p = await pattern("flagbad");
    expect((await flagCard(reviewer.id, P + "missing", "hello")).ok).toBe(false);
    expect((await flagCard(reviewer.id, p.slug, "   ")).ok).toBe(false);
    expect((await flagCard(reviewer.id, p.slug, "x".repeat(501))).ok).toBe(false);
    expect(await db.cardFlag.count({ where: { patternId: p.id } })).toBe(0);
  });

  it("returns the card, or the reason it is broken", async () => {
    const good = await pattern("cardok", 9001);
    const bad = await pattern("cardbad", 9002);
    await db.grammarPattern.update({ where: { id: bad.id }, data: { card: { rule: "" } } });
    const items = (await getGrammarForReview()).filter((g) => g.slug.startsWith(P));
    expect(items.map((g) => g.slug)).toEqual([good.slug, bad.slug]);
    expect(items[0].card?.rule).toBe("A rule");
    expect(items[1]).toMatchObject({ card: null, cardError: expect.any(String) });
  });
});

describe("setExercisePatterns", () => {
  async function exercise() {
    return db.exercise.findFirstOrThrow({ orderBy: [{ lessonId: "asc" }, { order: "asc" }, { id: "asc" }] });
  }
  const tags = async (exerciseId: string) =>
    (
      await db.exercisePattern.findMany({
        where: { exerciseId, pattern: { slug: { startsWith: P } } },
        include: { pattern: true },
      })
    )
      .map((t) => t.pattern.slug)
      .sort();

  it("replaces the tags, and an unknown slug fails with the old tags intact", async () => {
    const [a, b] = [await pattern("tag-a"), await pattern("tag-b")];
    const ex = await exercise();
    expect((await setExercisePatterns(ex.id, [a.slug])).ok).toBe(true);
    expect(await tags(ex.id)).toEqual([a.slug]);

    expect((await setExercisePatterns(ex.id, [b.slug, a.slug, a.slug])).ok).toBe(true);
    expect(await tags(ex.id)).toEqual([a.slug, b.slug]);

    const res = await setExercisePatterns(ex.id, [b.slug, P + "nope"]);
    expect(res).toEqual({ ok: false, message: expect.stringContaining(P + "nope") });
    expect(await tags(ex.id)).toEqual([a.slug, b.slug]);

    expect((await setExercisePatterns(ex.id, [])).ok).toBe(true);
    expect(await tags(ex.id)).toEqual([]);
  });

  it("shows each exercise's tags and the course's patterns on the review page", async () => {
    const p = await pattern("review");
    const ex = await exercise();
    await setExercisePatterns(ex.id, [p.slug]);
    const lesson = await db.lesson.findUniqueOrThrow({ where: { id: ex.lessonId }, select: { skillId: true } });
    const skill = await getSkillForReview(lesson.skillId);
    const shown = skill!.lessons.flatMap((l) => l.exercises).find((e) => e.id === ex.id);
    expect(shown?.patterns).toEqual([{ slug: p.slug, title: p.title }]);
    expect(skill!.patternOptions).toContainEqual({ slug: p.slug, title: p.title });
  });
});

describe("actions", () => {
  const denied = { ok: false, message: "Only reviewers can change course content." };

  /** Calls all five new actions with valid arguments for the fixture rows. */
  async function callAll(patternSlug: string, tableId: string, flagId: string, exerciseId: string) {
    const a = await import("@/app/actions/studio");
    return [
      await a.saveVerbTableAction(tableId, JSON.stringify(ruleForms)),
      await a.reviewVerbTableAction(tableId, "APPROVED"),
      await a.flagCardAction(patternSlug, "hello"),
      await a.resolveFlagAction(flagId),
      await a.setExercisePatternsAction(exerciseId, [patternSlug]),
    ];
  }

  async function fixtures() {
    const p = await pattern("actions");
    const t = await table();
    const flag = await db.cardFlag.create({ data: { patternId: p.id, userId: reviewer.id, note: "existing" } });
    const exercise = await db.exercise.findFirstOrThrow({
      orderBy: [{ lessonId: "asc" }, { order: "asc" }, { id: "asc" }],
    });
    return { p, t, flag, exercise };
  }

  /** Nothing the actions can write was written. */
  async function expectUntouched({ p, t, flag, exercise }: Awaited<ReturnType<typeof fixtures>>) {
    expect(await db.cardFlag.count({ where: { patternId: p.id } })).toBe(1);
    expect((await db.cardFlag.findUniqueOrThrow({ where: { id: flag.id } })).resolvedAt).toBeNull();
    const row = await db.verbTable.findUniqueOrThrow({ where: { id: t.id } });
    expect(row).toMatchObject({ status: "DRAFT", reviewedById: null });
    expect(await db.exercisePattern.count({ where: { exerciseId: exercise.id, patternId: p.id } })).toBe(0);
  }

  it("refuse a signed-in learner who is not a reviewer", async () => {
    const learner = await db.user.create({
      data: {
        id: `${P}user-${n++}`,
        email: `learner${Date.now()}-${n}@test.local`,
        name: "Learner",
        passwordHash: "x",
      },
    });
    const f = await fixtures();
    session.user = learner;
    const results = await callAll(f.p.slug, f.t.id, f.flag.id, f.exercise.id);
    expect(results).toEqual(Array(5).fill(denied));
    await expectUntouched(f);
  });

  it("refuse a visitor who is signed out", async () => {
    const f = await fixtures();
    session.user = null;
    const results = await callAll(f.p.slug, f.t.id, f.flag.id, f.exercise.id);
    expect(results).toEqual(Array(5).fill(denied));
    await expectUntouched(f);
  });

  it("answer malformed arguments with a clean message instead of a TypeError", async () => {
    const a = await import("@/app/actions/studio");
    const invalid = { ok: false, message: "That request was not valid." };
    const bad = (v: unknown) => v as never;
    expect(await a.setExercisePatternsAction("x", bad("not-an-array"))).toEqual(invalid);
    expect(await a.setExercisePatternsAction("x", bad([1]))).toEqual(invalid);
    expect(await a.flagCardAction("slug", bad(undefined))).toEqual(invalid);
    expect(await a.resolveFlagAction(bad(42))).toEqual(invalid);
    expect(await a.reviewVerbTableAction("x", "APPROVED", bad({}))).toEqual(invalid);
    expect(await a.saveVerbTableAction(bad(null), "{}")).toEqual(invalid);
  });

  it("run for a reviewer", async () => {
    const f = await fixtures();
    const results = await callAll(f.p.slug, f.t.id, f.flag.id, f.exercise.id);
    expect(results.map((r) => r.ok)).toEqual([false, true, true, true, true]); // the stray root is not in course.yaml
    expect(results[0].message).toContain("tstudio");
  });
});
