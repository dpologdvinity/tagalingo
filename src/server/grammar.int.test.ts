import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import type { User } from "@/generated/prisma/client";
import { getGrammarOverview, lookupWord, lookupWords, weakestPatterns } from "./grammar";
import { LessonError, startPractice } from "./lessons";

const SLUG = "t-grammar-";
const DAY = 86_400_000;

let user: User;
let courseId: string;
let n = 0;

async function firstLessons() {
  return db.lesson.findMany({
    orderBy: [{ skill: { unit: { order: "asc" } } }, { skill: { order: "asc" } }, { order: "asc" }],
    take: 2,
  });
}

const exerciseIds = async (lessonId: string) =>
  (await db.exercise.findMany({ where: { lessonId, status: "APPROVED" }, orderBy: { order: "asc" } })).map((e) => e.id);

/** A pattern taught by `lessonId`, tagged on the given exercises. */
async function pattern(name: string, lessonId: string, tagged: string[] = [], order = 900) {
  const p = await db.grammarPattern.create({
    data: {
      courseId,
      slug: SLUG + name,
      order,
      title: `Pattern ${name}`,
      lessonId,
      card: {
        rule: `Rule ${name}`,
        examples: [
          ["a", "b"],
          ["c", "d"],
        ],
        notes: [],
        mistakes: [["wrong", "Right: a."]],
      },
    },
  });
  await db.exercisePattern.createMany({ data: tagged.map((exerciseId) => ({ exerciseId, patternId: p.id })) });
  return p;
}

/** Mark a lesson finished without playing it. */
const finish = (lessonId: string) => db.lessonProgress.create({ data: { userId: user.id, lessonId } });

const progress = (patternId: string, strength: number, attempts: number, lastPracticedAt = new Date()) =>
  db.patternProgress.create({
    data: { userId: user.id, patternId, strength, attempts, correct: 0, lastPracticedAt },
  });

beforeAll(async () => {
  courseId = (await db.course.findFirstOrThrow()).id;
});

beforeEach(async () => {
  user = await db.user.create({
    data: { email: `grammar${Date.now()}-${n++}@test.local`, name: "Grammar Learner", passwordHash: "x" },
  });
});

afterEach(async () => {
  await db.grammarPattern.deleteMany({ where: { slug: { startsWith: SLUG } } });
});

afterAll(async () => {
  await db.$disconnect();
});

describe("grammar overview", () => {
  it("treats patterns of completed lessons as unlocked", async () => {
    const [first, second] = await firstLessons();
    await pattern("done", first.id, [], 900);
    await pattern("later", second.id, [], 901);
    await finish(first.id);

    const mine = (await getGrammarOverview(user.id, new Date())).filter((i) => i.slug.startsWith(SLUG));
    expect(mine).toEqual([
      expect.objectContaining({
        slug: `${SLUG}done`,
        unlocked: true,
        card: expect.objectContaining({ rule: "Rule done" }),
        label: "new",
        effective: 0,
      }),
      expect.objectContaining({ slug: `${SLUG}later`, unlocked: false, card: null }),
    ]);
    // Common mistakes are for grading; the page never shows them, so they stay on the server.
    expect(mine[0].card).not.toHaveProperty("mistakes");
  });

  it("refuses a stored card that doesn't match the card schema", async () => {
    const [first] = await firstLessons();
    const p = await pattern("broken", first.id);
    await db.grammarPattern.update({ where: { id: p.id }, data: { card: { rule: "", examples: "nope" } } });
    await finish(first.id);
    await expect(getGrammarOverview(user.id, new Date())).rejects.toThrow(/t-grammar-broken/);
  });
});

describe("pattern practice", () => {
  it("pattern practice serves only tagged exercises from finished lessons", async () => {
    const [first, second] = await firstLessons();
    const own = (await exerciseIds(first.id)).slice(0, 4);
    const p = await pattern("p", first.id, [...own, ...(await exerciseIds(second.id))]);
    await finish(first.id);

    const { attemptId, exercises } = await startPractice(user, { patternSlug: p.slug });
    expect(exercises.length).toBeGreaterThan(0);
    expect(exercises.length).toBeLessThanOrEqual(10);
    expect(exercises.every((e) => own.includes(e.id))).toBe(true);
    expect(await db.lessonAttempt.findUniqueOrThrow({ where: { id: attemptId } })).toMatchObject({
      kind: "PRACTICE",
      patternId: p.id,
    });
    await expect(startPractice(user, { patternSlug: `${SLUG}missing` })).rejects.toMatchObject({ code: "not_found" });
  });

  it("weakGrammar picks the lowest effective strengths with ≥ 3 attempts", async () => {
    const [first, second] = await firstLessons();
    const ids = await exerciseIds(first.id);
    await finish(first.id);
    const now = new Date();
    const low = await pattern("low", first.id, ids.slice(0, 4));
    const decayed = await pattern("decayed", first.id, ids.slice(4, 6), 901);
    const mid = await pattern("mid", first.id, ids.slice(6, 7), 902);
    const few = await pattern("few", first.id, ids.slice(7, 8), 903);
    const strong = await pattern("strong", first.id, ids.slice(7, 8), 904);
    const locked = await pattern("locked", second.id, ids.slice(7, 8), 905);
    await progress(low.id, 0.2, 5, now);
    await progress(decayed.id, 0.9, 5, new Date(now.getTime() - 63 * DAY)); // 0.9 / 8 = 0.1125
    await progress(mid.id, 0.5, 3, now);
    await progress(few.id, 0.05, 2, now);
    await progress(strong.id, 0.95, 10, now);
    await progress(locked.id, 0, 5, now);

    const weakest = (await weakestPatterns(user.id, now)).filter((s) => s.startsWith(SLUG));
    expect(weakest).toEqual([decayed.slug, low.slug, mid.slug]);

    const { exercises } = await startPractice(user, { weakGrammar: true }, now);
    const allowed = new Set(ids.slice(0, 7));
    expect(exercises.length).toBe(7);
    expect(exercises.every((e) => allowed.has(e.id))).toBe(true);
    // Round robin: the first three come from the three different patterns, weakest first.
    const [a, b, c] = exercises.map((e) => ids.indexOf(e.id));
    expect([a >= 4 && a < 6, b < 4, c === 6]).toEqual([true, true, true]);
  });

  it('weakGrammar with no eligible patterns throws LessonError("not_found")', async () => {
    const [first] = await firstLessons();
    await finish(first.id);
    const p = await pattern("few", first.id, await exerciseIds(first.id));
    await progress(p.id, 0.1, 2);
    const err = await startPractice(user, { weakGrammar: true }).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(LessonError);
    expect(err).toMatchObject({ code: "not_found" });
  });
});

// The lookups below run against the shipped approved tables too, so they use made-up "tgr" roots and
// spellings that no course verb can share, and clean up only the "tgr" rows they create.
describe("word lookup", () => {
  it("analyses a word against approved verb tables only", async () => {
    const forms = {
      infinitive: ["tgrsumulat"],
      completed: ["tgrsumulat"],
      incompleted: ["tgrsumusulat"],
      contemplated: ["tgrsusulat"],
    };
    await db.verbTable.create({
      data: { courseId, root: "tgrsulat", affix: "um", en: "write", forms, status: "APPROVED" },
    });
    await db.verbTable.create({
      data: {
        courseId,
        root: "tgrsulat",
        affix: "mag",
        en: "write",
        forms: { ...forms, incompleted: ["tgrsumusulat"] },
      },
    });
    try {
      expect(await lookupWord("Tgrsumusulat")).toEqual([
        { root: "tgrsulat", affix: "um", en: "write", form: "incompleted", canonical: "tgrsumusulat" },
      ]);
      expect(await lookupWord("wala")).toEqual([]);
    } finally {
      await db.verbTable.deleteMany({ where: { courseId, root: { startsWith: "tgr" } } });
    }
  });

  it("looks several words up at once, grouped by table, keeping every reading of an ambiguous word", async () => {
    const um = {
      infinitive: ["tgrkumain"],
      completed: ["tgrkumain"],
      incompleted: ["tgrkumakain"],
      contemplated: ["tgrkakain"],
    };
    const mag = {
      infinitive: ["tgrmagkain"],
      completed: ["tgrnagkain"],
      incompleted: ["tgrnagkakain"],
      contemplated: ["tgrmagkakain"],
    };
    await db.verbTable.createMany({
      data: [
        { courseId, root: "tgrkain", affix: "um", en: "eat", forms: um, status: "APPROVED" },
        { courseId, root: "tgrkain", affix: "mag", en: "eat", forms: mag, status: "APPROVED" },
        { courseId, root: "tgrkain", affix: "ma", en: "draft", forms: um },
      ],
    });
    try {
      const found = await lookupWords(["Tgrkumain", "tgrnagkakain", "tgrkakain", "wala", "tgrkumain", ""]);
      expect(Object.keys(found).sort()).toEqual(["tgrkakain", "tgrkumain", "tgrnagkakain"]);
      // tgrkumain is both (like kumain) the infinitive and the past of kain/um: one table, two readings.
      expect(found.tgrkumain).toHaveLength(1);
      expect(found.tgrkumain[0].table).toMatchObject({ root: "tgrkain", affix: "um", en: "eat", forms: um });
      expect(found.tgrkumain[0].analyses.map((a) => a.form)).toEqual(["infinitive", "completed"]);
      expect(found.tgrnagkakain[0].table.affix).toBe("mag");
      expect(found.tgrnagkakain[0].analyses).toEqual([
        { root: "tgrkain", affix: "mag", en: "eat", form: "incompleted", canonical: "tgrnagkakain" },
      ]);
    } finally {
      await db.verbTable.deleteMany({ where: { courseId, root: { startsWith: "tgr" } } });
    }
  });

  it("returns nothing for no words, and refuses more than the cap", async () => {
    expect(await lookupWords([])).toEqual({});
    await expect(lookupWords(Array.from({ length: 61 }, (_, i) => `w${i}`))).rejects.toThrow(/at most 60/);
  });
});
