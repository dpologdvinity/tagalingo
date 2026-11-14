/**
 * Integration tests for the grammar half of the content pipeline: pattern sync, pattern tags on
 * exported exercises, and the verb-table draft / export / import cycle (against `tagalingo_test`).
 *
 * The test database already holds the shipped course, including whatever grammar content it has
 * (patterns, tagged exercises, approved verb tables). These tests must hold with or without that
 * content and must leave it as they found it:
 *  - everything a test creates is a scratch skill (a copy of the first skill's words, appended to the
 *    first unit) plus patterns and verbs named `tgr-...` / `tgr...`, so nothing collides with real rows;
 *  - the shipped patterns stay in every course definition passed to `syncCourseStructure`, because
 *    dropping a pattern would drop its exercise tags with it;
 *  - the approved verb tables are parked for the duration of each test and put back afterwards, so
 *    exporting and importing them sees only the test's rows.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, afterEach, beforeEach, describe, expect, it } from "vitest";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient, type VerbTable } from "@/generated/prisma/client";
import { conjugate, type FormTable, type VerbEntry } from "@/lib/grammar/morphology";
import { loadCourseFile, type CourseDefinition } from "./course";
import {
  draftVerbTables,
  exportVerbTables,
  importVerbTables,
  loadApprovedVerbTables,
  syncGrammar,
} from "./grammar-persist";
import type { CoursePattern } from "./grammar-schema";
import { COURSE_FILE } from "./paths";
import { StubGenerator } from "./generators/stub";
import type { ExerciseGenerator } from "./generators/types";
import {
  exportApprovedExercises,
  generateDraftsForLesson,
  importApprovedExercises,
  syncCourseStructure,
} from "./persist";

const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL! }) });

const shipped = loadCourseFile(COURSE_FILE);
const SCRATCH_SKILL = "tgr-scratch-skill";
let tmp: string;
let parkedTables: VerbTable[];

beforeEach(async () => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), "grammar-persist-"));
  parkedTables = await prisma.verbTable.findMany();
  await prisma.verbTable.deleteMany();
});

afterEach(async () => {
  fs.rmSync(tmp, { recursive: true, force: true });
  await prisma.verbTable.deleteMany();
  await prisma.verbTable.createMany({ data: parkedTables.map((t) => ({ ...t, forms: t.forms as object })) });
  // Dropping the scratch patterns (they are not in the shipped course) also drops their exercise tags;
  // the scratch skill then goes with its lessons, exercises and generation runs.
  await syncCourseStructure(prisma, shipped);
  await prisma.skill.deleteMany({ where: { slug: SCRATCH_SKILL } });
});

afterAll(async () => {
  await prisma.$disconnect();
});

function pattern(id: string, title: string): CoursePattern {
  return {
    id,
    title,
    rule: `Rule for ${title}.`,
    table: undefined,
    examples: [
      ["Kumain ako.", "I ate."],
      ["Kumain siya.", "He ate."],
    ],
    notes: [],
    mistakes: [],
    requires: [],
    drills: { frames: [], transforms: [], choices: [] },
  };
}

const verb = (root: string, affixes: VerbEntry["affixes"]): VerbEntry => ({
  root,
  en: `to ${root}`,
  affixes,
  glottal: false,
  stem: null,
  forms: {},
});

/**
 * The shipped course plus a scratch skill: a copy of the first skill's words, appended to the first
 * unit, whose lessons teach nothing except that the first teaches `patterns` (which are added to the
 * course's grammar after the shipped ones). No other skill has verbs, so only `verbs` (listed on the
 * scratch skill) are drafted, exported or imported.
 */
function scratchCourse(patterns: CoursePattern[] = [], verbs: VerbEntry[] = []): CourseDefinition {
  const def = structuredClone(shipped);
  for (const skill of def.units.flatMap((u) => u.skills)) skill.verbs = [];
  const skill = structuredClone(def.units[0].skills[0]);
  skill.slug = SCRATCH_SKILL;
  skill.verbs = verbs;
  for (const lesson of skill.lessons) Object.assign(lesson, { teaches: [], uses: [] });
  skill.lessons[0].teaches = patterns.map((p) => p.id);
  def.units[0].skills.push(skill);
  def.grammar = [...shipped.grammar, ...patterns];
  return def;
}

/** The shipped course with `verbs` on its first skill and no other verbs (for the verb-table cycle). */
function courseWithVerbs(...verbs: VerbEntry[]): CourseDefinition {
  const def = structuredClone(shipped);
  for (const skill of def.units.flatMap((u) => u.skills)) skill.verbs = [];
  def.units[0].skills[0].verbs = verbs;
  return def;
}

async function courseId(def: CourseDefinition) {
  return (await prisma.course.findUniqueOrThrow({ where: { slug: def.course.slug } })).id;
}

/** The stub without its grammar drills: what a lesson looked like before grammar content existed. */
const vocabularyOnly: ExerciseGenerator = {
  provider: "stub",
  model: "stub",
  generate: async (request, tables) => {
    const result = await new StubGenerator().generate(request, tables);
    return { ...result, exercises: result.exercises.filter((e) => e.patterns.length === 0) };
  },
};

/** The scratch skill's lesson, with its exercises in order and the patterns they are tagged with. */
async function scratchLessonRows(order = 1) {
  const skill = await prisma.skill.findUniqueOrThrow({ where: { slug: SCRATCH_SKILL } });
  const lesson = await prisma.lesson.findUniqueOrThrow({ where: { skillId_order: { skillId: skill.id, order } } });
  return prisma.exercise.findMany({
    where: { lessonId: lesson.id },
    orderBy: { order: "asc" },
    include: { patterns: { include: { pattern: true } } },
  });
}

describe("syncGrammar", () => {
  it("upserts patterns and removes the ones dropped from course.yaml", async () => {
    const def = scratchCourse([pattern("tgr-um-verbs", "um verbs"), pattern("tgr-mag-verbs", "mag verbs")]);
    def.units[0].skills.at(-1)!.lessons[1].teaches = ["tgr-mag-verbs"];
    def.units[0].skills.at(-1)!.lessons[0].teaches = ["tgr-um-verbs"];
    await syncCourseStructure(prisma, def);

    const mine = { courseId: await courseId(def), slug: { startsWith: "tgr-" } };
    const rows = await prisma.grammarPattern.findMany({
      where: mine,
      orderBy: { order: "asc" },
      include: { lesson: { include: { skill: true } } },
    });
    // Test patterns follow the shipped ones in the course's grammar list.
    const first = shipped.grammar.length + 1;
    expect(rows.map((r) => [r.slug, r.order, r.title])).toEqual([
      ["tgr-um-verbs", first, "um verbs"],
      ["tgr-mag-verbs", first + 1, "mag verbs"],
    ]);
    expect(rows.map((r) => [r.lesson.skill.slug, r.lesson.order])).toEqual([
      [SCRATCH_SKILL, 1],
      [SCRATCH_SKILL, 2],
    ]);
    // The card keeps what learners read; ids, prerequisites and drill ingredients stay in the yaml.
    expect(Object.keys(rows[0].card as object).sort()).toEqual(["examples", "mistakes", "notes", "rule"]);

    // Edit one pattern and drop the other.
    const edited = structuredClone(def);
    edited.grammar = [...shipped.grammar, { ...edited.grammar.at(-2)!, title: "um verbs, revised" }];
    edited.units[0].skills.at(-1)!.lessons[1].teaches = [];
    await syncGrammar(prisma, edited);
    const after = await prisma.grammarPattern.findMany({ where: mine });
    expect(after.map((r) => [r.slug, r.title, r.id])).toEqual([["tgr-um-verbs", "um verbs, revised", rows[0].id]]);
  });

  it("keeps the shipped patterns, and the exercise tags on them, when test patterns come and go", async () => {
    const real = await prisma.grammarPattern.findMany({ select: { id: true, slug: true } });
    const tagsBefore = await prisma.exercisePattern.count();
    await syncCourseStructure(prisma, scratchCourse([pattern("tgr-um-verbs", "um verbs")]));
    await syncCourseStructure(prisma, shipped);
    const after = await prisma.grammarPattern.findMany({ select: { id: true, slug: true } });
    expect(after.sort((a, b) => a.slug.localeCompare(b.slug))).toEqual(
      real.sort((a, b) => a.slug.localeCompare(b.slug)),
    );
    expect(await prisma.exercisePattern.count()).toBe(tagsBefore);
  });
});

describe("exercise export/import", () => {
  it("round-trips pattern tags", async () => {
    const def = scratchCourse([pattern("tgr-um-verbs", "um verbs"), pattern("tgr-mag-verbs", "mag verbs")]);
    await syncCourseStructure(prisma, def);
    // The scratch lesson gets vocabulary exercises, approved as a reviewer would.
    await generateDraftsForLesson(prisma, vocabularyOnly, def, { skillSlug: SCRATCH_SKILL, lessonOrder: 1 });
    await prisma.exercise.updateMany({
      where: { lesson: { skill: { slug: SCRATCH_SKILL } } },
      data: { status: "APPROVED" },
    });
    const lesson = await prisma.lesson.findFirstOrThrow({ where: { skill: { slug: SCRATCH_SKILL }, order: 1 } });
    const [tagged] = await scratchLessonRows();
    const patterns = await prisma.grammarPattern.findMany({ where: { slug: { startsWith: "tgr-" } } });
    await prisma.exercisePattern.createMany({
      data: patterns.map((p) => ({ exerciseId: tagged.id, patternId: p.id })),
    });

    const written = await exportApprovedExercises(prisma, tmp);
    const file = JSON.parse(fs.readFileSync(path.join(tmp, "exercises", `${SCRATCH_SKILL}.json`), "utf8"));
    expect(file.skill).toBe(SCRATCH_SKILL);
    expect(file.lessons[0].exercises[0].patterns).toEqual(["tgr-mag-verbs", "tgr-um-verbs"]);
    expect(file.lessons[0].exercises[1].patterns).toEqual([]);

    // Re-import just the scratch skill's file into a database that has lost its exercises.
    for (const f of written) if (path.basename(f) !== `${SCRATCH_SKILL}.json`) fs.rmSync(f);
    await prisma.exercise.deleteMany({ where: { lesson: { skill: { slug: SCRATCH_SKILL } } } });
    await importApprovedExercises(prisma, tmp);

    const retagged = await prisma.exercisePattern.findMany({
      where: { exercise: { lessonId: lesson.id } },
      include: { exercise: true, pattern: true },
    });
    expect(retagged.map((t) => [t.exercise.order, t.pattern.slug]).sort()).toEqual([
      [1, "tgr-mag-verbs"],
      [1, "tgr-um-verbs"],
    ]);
  });

  it("rejects a tag for a pattern that is not in the course, importing nothing", async () => {
    await syncCourseStructure(prisma, shipped);
    const skillSlug = shipped.units[0].skills[0].slug;
    const original = await prisma.exercise.findFirstOrThrow({
      where: { status: "APPROVED", lesson: { skill: { slug: skillSlug }, order: 1 } },
    });
    const before = await prisma.exercise.count();
    const entry = { type: original.type, payload: original.payload, source: "HUMAN", patterns: ["nope"] };
    fs.mkdirSync(path.join(tmp, "exercises"));
    fs.writeFileSync(
      path.join(tmp, "exercises", `${skillSlug}.json`),
      JSON.stringify({ skill: skillSlug, lessons: [{ order: 1, title: "x", exercises: [entry] }] }),
    );
    await expect(importApprovedExercises(prisma, tmp)).rejects.toThrow(/pattern "nope"/);
    expect(await prisma.exercise.count()).toBe(before);
  });
});

describe("verb tables", () => {
  // Made-up roots: no course verb shares them. The shipped tables are parked for the test (see the header).
  const KAIN = verb("tgrkain", ["um", "in"]);
  const table = (completed: string[]): FormTable => ({ ...conjugate(KAIN, "um"), completed });

  it("draftVerbTables creates drafts and skips existing rows of any status", async () => {
    const def = courseWithVerbs(KAIN);
    await syncCourseStructure(prisma, def);
    const id = await courseId(def);

    const first = await draftVerbTables(prisma, def);
    expect(first).toMatchObject({ created: 2, unchanged: 0 });
    const um = await prisma.verbTable.findUniqueOrThrow({
      where: { courseId_root_affix: { courseId: id, root: "tgrkain", affix: "um" } },
    });
    expect(um.status).toBe("DRAFT");
    expect(um.forms).toEqual(conjugate(KAIN, "um"));

    // A reviewed table must survive a re-run untouched.
    const reviewed = table(["tgrkumain", "tgrkinain"]);
    await prisma.verbTable.update({ where: { id: um.id }, data: { status: "APPROVED", forms: reviewed } });
    const second = await draftVerbTables(prisma, def);
    expect(second).toMatchObject({ created: 0, unchanged: 2 });
    const after = await prisma.verbTable.findUniqueOrThrow({ where: { id: um.id } });
    expect(after.status).toBe("APPROVED");
    expect(after.forms).toEqual(reviewed);
  });

  it("draftVerbTables skips combinations the engine cannot conjugate", async () => {
    const def = courseWithVerbs(verb("tgrkain", ["um"]), verb("tgrpst", ["um"]));
    await syncCourseStructure(prisma, def);
    const result = await draftVerbTables(prisma, def);
    expect(result).toMatchObject({ created: 1, unchanged: 0, skipped: ["tgrpst/um"] });
  });

  /** The engine's own output for a verb, i.e. a table that needs no `irregular` marks. */
  const rule = (v: VerbEntry, affix: VerbEntry["affixes"][number]) => conjugate(v, affix);

  it("exports approved tables sorted by root then affix, and imports them back", async () => {
    const basa = verb("tgrbasa", ["um"]);
    const def = courseWithVerbs(KAIN, basa);
    await syncCourseStructure(prisma, def);
    const id = await courseId(def);
    const irregularForms = { ...rule(KAIN, "um"), completed: ["tgrkumain", "tgrkinain"] };
    await prisma.verbTable.createMany({
      data: [
        { courseId: id, root: "tgrkain", affix: "in", en: "eat", forms: rule(KAIN, "in"), status: "APPROVED" },
        {
          courseId: id,
          root: "tgrkain",
          affix: "um",
          en: "eat",
          forms: irregularForms,
          status: "APPROVED",
          irregular: ["completed"],
          reviewNote: "variant tgrkinain is common",
        },
        { courseId: id, root: "tgrbasa", affix: "um", en: "read", forms: rule(basa, "um"), status: "APPROVED" },
        {
          courseId: id,
          root: "tgrluto",
          affix: "um",
          en: "cook",
          forms: rule(verb("tgrluto", ["um"]), "um"),
          status: "DRAFT",
        },
      ],
    });

    const file = await exportVerbTables(prisma, tmp);
    expect(file).toBe(path.join(tmp, "grammar", "verbs.json"));
    const written = JSON.parse(fs.readFileSync(file!, "utf8"));
    expect(written.verbs.map((v: { root: string; affix: string }) => `${v.root}/${v.affix}`)).toEqual([
      "tgrbasa/um",
      "tgrkain/um",
      "tgrkain/in",
    ]);
    expect(written.verbs[1]).toMatchObject({ irregular: ["completed"], reviewNote: "variant tgrkinain is common" });

    await prisma.verbTable.deleteMany();
    await importVerbTables(prisma, def, tmp);
    const rows = await prisma.verbTable.findMany({ orderBy: [{ root: "asc" }, { affix: "asc" }] });
    expect(rows.map((r) => [r.root, r.affix, r.status])).toEqual([
      ["tgrbasa", "um", "APPROVED"],
      ["tgrkain", "um", "APPROVED"],
      ["tgrkain", "in", "APPROVED"],
    ]);
    const kainUm = rows.find((r) => r.root === "tgrkain" && r.affix === "um")!;
    expect(kainUm.forms).toEqual(irregularForms);
    expect(kainUm.irregular).toEqual(["completed"]);
    expect(kainUm.reviewNote).toBe("variant tgrkinain is common");
    expect(kainUm.reviewedAt).not.toBeNull();

    // Importing again updates in place rather than failing on the unique key.
    await importVerbTables(prisma, def, tmp);
    expect(await prisma.verbTable.count()).toBe(3);
  });

  it("writes no file when nothing is approved", async () => {
    await syncCourseStructure(prisma, courseWithVerbs(verb("tgrkain", ["um"])));
    expect(await exportVerbTables(prisma, tmp)).toBeNull();
    expect(fs.existsSync(path.join(tmp, "grammar"))).toBe(false);
  });

  describe("import", () => {
    const def = courseWithVerbs(verb("tgrkain", ["um"]));
    const writeFile = (irregular: string[], completed: string[]) => {
      fs.mkdirSync(path.join(tmp, "grammar"));
      fs.writeFileSync(
        path.join(tmp, "grammar", "verbs.json"),
        JSON.stringify({
          verbs: [{ root: "tgrkain", affix: "um", en: "eat", forms: table(completed), irregular, reviewNote: "" }],
        }),
      );
    };

    it("rejects a form that differs from the rule and is not marked irregular", async () => {
      writeFile([], ["tgrkinain"]);
      await syncCourseStructure(prisma, def);
      await expect(importVerbTables(prisma, def, tmp)).rejects.toThrow(/tgrkain.*um.*completed/);
      expect(await prisma.verbTable.count()).toBe(0);
    });

    it("accepts the same form once it is marked irregular", async () => {
      writeFile(["completed"], ["tgrkinain"]);
      await syncCourseStructure(prisma, def);
      await importVerbTables(prisma, def, tmp);
      expect(await prisma.verbTable.count()).toBe(1);
    });

    it("matches a table on root and affix when two skills list the same root with different affixes", async () => {
      writeFile([], conjugate(KAIN, "um").completed);
      const both = courseWithVerbs(verb("tgrkain", ["in"]));
      both.units[0].skills[1].verbs = [verb("tgrkain", ["um"])];
      await syncCourseStructure(prisma, both);
      await expect(importVerbTables(prisma, both, tmp)).resolves.toBe(1);
    });

    it("rejects a table for a verb that is not in course.yaml", async () => {
      writeFile([], conjugate(KAIN, "um").completed);
      const other = courseWithVerbs(verb("tgrbasa", ["um"]));
      await syncCourseStructure(prisma, other);
      await expect(importVerbTables(prisma, other, tmp)).rejects.toThrow(/tgrkain/);
    });

    it("does nothing when there is no verbs.json", async () => {
      await syncCourseStructure(prisma, def);
      await expect(importVerbTables(prisma, def, tmp)).resolves.toBe(0);
    });
  });
});

describe("generateDraftsForLesson with grammar", () => {
  const TGRKAIN = verb("tgrkain", ["um"]);

  /** The scratch skill's first lesson teaches tgr-um-verbs, with a tgrkain/um frame to drill it. */
  function grammarCourse(): CourseDefinition {
    const um = pattern("tgr-um-verbs", "um verbs");
    um.drills = { frames: [["___ ako.", "I ate.", "um", "completed"]], transforms: [], choices: [] };
    return scratchCourse([um], [TGRKAIN]);
  }
  const target = { skillSlug: SCRATCH_SKILL, lessonOrder: 1 };

  it("loads only the course's approved tables", async () => {
    const def = grammarCourse();
    await syncCourseStructure(prisma, def);
    await draftVerbTables(prisma, def);
    expect(await loadApprovedVerbTables(prisma, await courseId(def))).toEqual([]);

    await prisma.verbTable.updateMany({ data: { status: "APPROVED" } });
    expect(await loadApprovedVerbTables(prisma, await courseId(def))).toEqual([
      { root: "tgrkain", affix: "um", en: "to tgrkain", forms: conjugate(TGRKAIN, "um") },
    ]);
  });

  it("tags the grammar drills it writes and builds them only from approved tables", async () => {
    const def = grammarCourse();
    await syncCourseStructure(prisma, def);
    await draftVerbTables(prisma, def);
    const tagged = async () => (await scratchLessonRows()).filter((e) => e.patterns.length);

    // A DRAFT table is not reviewed yet: the lesson gets vocabulary drills only.
    const vocabulary = await generateDraftsForLesson(prisma, new StubGenerator(), def, target);
    expect(await tagged()).toEqual([]);

    await prisma.verbTable.updateMany({ data: { status: "APPROVED" } });
    const withGrammar = await generateDraftsForLesson(prisma, new StubGenerator(), def, target);
    // The frame's conjugation, plus the paradigm every um- pattern gets; both tagged and still drafts.
    expect((await tagged()).map((e) => [e.patterns[0].pattern.slug, e.type, e.status]).sort()).toEqual([
      ["tgr-um-verbs", "conjugate", "DRAFT"],
      ["tgr-um-verbs", "paradigm", "DRAFT"],
    ]);
    expect(withGrammar.created).toBe(vocabulary.created + 2);
    expect(withGrammar.rejected).toBe(0);
  });

  it("reports grammar rejections in the result and on the GenerationRun", async () => {
    const def = grammarCourse();
    def.grammar.at(-1)!.drills.frames.push(["___ ako ng bulaklak.", "I ate a flower.", "um", "completed"]);
    await syncCourseStructure(prisma, def);
    await draftVerbTables(prisma, def);
    await prisma.verbTable.updateMany({ data: { status: "APPROVED" } });

    const result = await generateDraftsForLesson(prisma, new StubGenerator(), def, target);
    expect(result.rejected).toBe(1);
    expect(result.rejectedReasons).toEqual([expect.stringMatching(/unknown word "bulaklak"/)]);
    const run = await prisma.generationRun.findUniqueOrThrow({ where: { id: result.runId } });
    expect(run.error).toMatch(/^1 item\(s\) failed validation: .*bulaklak/);
  });

  it("records a failed run and writes nothing when a draft names an unknown pattern", async () => {
    const def = grammarCourse();
    await syncCourseStructure(prisma, def);
    const generator: ExerciseGenerator = {
      provider: "stub",
      model: "fake",
      generate: async () => ({
        exercises: [
          {
            type: "speak",
            payload: { text: "Kumusta po.", translation: "Hello." },
            patterns: ["no-such-pattern"],
          },
        ],
        rejected: [],
      }),
    };

    await expect(generateDraftsForLesson(prisma, generator, def, target)).rejects.toThrow(/no-such-pattern/);
    expect(await scratchLessonRows()).toEqual([]);
    const runs = await prisma.generationRun.findMany({ where: { model: "fake" } });
    expect(runs).toHaveLength(1);
    expect(runs[0].error).toMatch(/no-such-pattern/);
  });
});

describe("generateDraftsForLesson with grammarOnly", () => {
  const PATTERN = "tgr-only";

  /** A scratch lesson that teaches a scratch pattern with three multiple-choice questions. */
  function onlyCourse(): CourseDefinition {
    const choice = (n: number): CoursePattern["drills"]["choices"][number] => [
      `Siya ang ___ ${n}.`,
      "English.",
      ["ako", "siya", "kami"],
      1,
      ["Ako is I.", null, "Kami is we."],
    ];
    return scratchCourse([
      { ...pattern(PATTERN, "Scratch"), drills: { frames: [], transforms: [], choices: [1, 2, 3].map(choice) } },
    ]);
  }

  it("adds only tagged DRAFT grammar drills after the 4th exercise and does it once", async () => {
    const def = onlyCourse();
    await syncCourseStructure(prisma, def);
    const target = { skillSlug: SCRATCH_SKILL, lessonOrder: 1 };
    await generateDraftsForLesson(prisma, vocabularyOnly, def, target);
    const before = await scratchLessonRows();
    expect(before.length).toBeGreaterThan(4);
    expect(before.map((e) => e.order)).toEqual(before.map((_, i) => i + 1));

    const result = await generateDraftsForLesson(prisma, new StubGenerator(), def, target, undefined, {
      grammarOnly: true,
    });
    expect(result).toMatchObject({ created: 3, skipped: 0, rejected: 0 });

    const after = await scratchLessonRows();
    expect(after.map((e) => e.order)).toEqual(after.map((_, i) => i + 1));
    // The vocabulary exercises keep their order; the grammar drills sit between the 4th and the 5th.
    const added = after.slice(4, 7);
    expect(after.filter((e) => !added.includes(e)).map((e) => e.id)).toEqual(before.map((e) => e.id));
    for (const e of added) {
      expect(e.status).toBe("DRAFT");
      expect(e.type).toBe("fill_blank");
      expect(e.patterns.map((t) => t.pattern.slug)).toEqual([PATTERN]);
    }
    expect(after.filter((e) => e.patterns.length === 0)).toHaveLength(before.length);

    // Running it again (even after a reviewer acted on a drill) adds nothing and moves nothing.
    await prisma.exercise.update({ where: { id: added[0].id }, data: { status: "APPROVED" } });
    await prisma.exercise.update({ where: { id: added[1].id }, data: { status: "REJECTED" } });
    const again = await generateDraftsForLesson(prisma, new StubGenerator(), def, target, undefined, {
      grammarOnly: true,
    });
    expect(again).toMatchObject({ created: 0, skipped: 3, rejected: 0 });
    expect((await scratchLessonRows()).map((e) => e.id)).toEqual(after.map((e) => e.id));
  });

  it("starts at the top of a lesson that has no exercises yet", async () => {
    const def = onlyCourse();
    await syncCourseStructure(prisma, def);
    const target = { skillSlug: SCRATCH_SKILL, lessonOrder: 1 };
    const result = await generateDraftsForLesson(prisma, new StubGenerator(), def, target, undefined, {
      grammarOnly: true,
    });
    expect(result.created).toBe(3);
    expect((await scratchLessonRows()).map((e) => e.order)).toEqual([1, 2, 3]);
  });

  it("appends after the last exercise when the lesson has one to three", async () => {
    const def = onlyCourse();
    await syncCourseStructure(prisma, def);
    const lesson = await prisma.lesson.findFirstOrThrow({ where: { skill: { slug: SCRATCH_SKILL }, order: 1 } });
    await prisma.exercise.createMany({
      data: [1, 2].map((order) => ({
        lessonId: lesson.id,
        order,
        type: "speak" as const,
        payload: { text: `Salamat po ${order}.`, translation: "Thank you." },
        status: "APPROVED" as const,
        source: "HUMAN" as const,
      })),
    });
    const before = await scratchLessonRows();

    const target = { skillSlug: SCRATCH_SKILL, lessonOrder: 1 };
    const result = await generateDraftsForLesson(prisma, new StubGenerator(), def, target, undefined, {
      grammarOnly: true,
    });
    expect(result.created).toBe(3);
    const after = await scratchLessonRows();
    expect(after.map((e) => e.order)).toEqual([1, 2, 3, 4, 5]);
    expect(after.slice(0, 2).map((e) => e.id)).toEqual(before.map((e) => e.id));
    expect(after.slice(2).every((e) => e.status === "DRAFT" && e.patterns.length === 1)).toBe(true);
  });
});
