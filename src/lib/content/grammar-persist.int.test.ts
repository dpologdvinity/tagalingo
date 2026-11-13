/**
 * Integration tests for the grammar half of the content pipeline: pattern sync, pattern tags on
 * exported exercises, and the verb-table draft / export / import cycle (against `tagalingo_test`).
 *
 * Every test starts from the shipped course and puts it back afterwards, so other files see the
 * database as the global setup left it.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, afterEach, beforeEach, describe, expect, it } from "vitest";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "@/generated/prisma/client";
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
import { COURSE_FILE, CONTENT_DIR } from "./paths";
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
let tmp: string;

beforeEach(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), "grammar-persist-"));
});

afterEach(async () => {
  fs.rmSync(tmp, { recursive: true, force: true });
  await prisma.verbTable.deleteMany();
  // Dropping the test patterns (they are not in the shipped course) also drops their exercise tags.
  await syncCourseStructure(prisma, shipped);
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

/** The shipped course with two patterns taught by its first two lessons. */
function courseWithPatterns(): CourseDefinition {
  const def = structuredClone(shipped);
  def.grammar = [pattern("um-verbs", "um verbs"), pattern("mag-verbs", "mag verbs")];
  const lessons = def.units[0].skills[0].lessons;
  lessons[0].teaches = ["um-verbs"];
  lessons[1].teaches = ["mag-verbs"];
  return def;
}

const verb = (root: string, affixes: VerbEntry["affixes"]): VerbEntry => ({
  root,
  en: `to ${root}`,
  affixes,
  glottal: false,
  stem: null,
  forms: {},
});

/** The shipped course with `verbs` attached to its first skill. */
function courseWithVerbs(...verbs: VerbEntry[]): CourseDefinition {
  const def = structuredClone(shipped);
  def.units[0].skills[0].verbs = verbs;
  return def;
}

async function courseId(def: CourseDefinition) {
  return (await prisma.course.findUniqueOrThrow({ where: { slug: def.course.slug } })).id;
}

describe("syncGrammar", () => {
  it("upserts patterns and removes the ones dropped from course.yaml", async () => {
    const def = courseWithPatterns();
    await syncCourseStructure(prisma, def);

    const rows = await prisma.grammarPattern.findMany({
      where: { courseId: await courseId(def) },
      orderBy: { order: "asc" },
      include: { lesson: { include: { skill: true } } },
    });
    expect(rows.map((r) => [r.slug, r.order, r.title])).toEqual([
      ["um-verbs", 1, "um verbs"],
      ["mag-verbs", 2, "mag verbs"],
    ]);
    expect(rows.map((r) => [r.lesson.skill.slug, r.lesson.order])).toEqual([
      [def.units[0].skills[0].slug, 1],
      [def.units[0].skills[0].slug, 2],
    ]);
    // The card keeps what learners read; ids, prerequisites and drill ingredients stay in the yaml.
    expect(Object.keys(rows[0].card as object).sort()).toEqual(["examples", "mistakes", "notes", "rule"]);

    // Edit one pattern, swap the order, and drop the other.
    const edited = structuredClone(def);
    edited.grammar = [{ ...edited.grammar[0], title: "um verbs, revised" }];
    edited.units[0].skills[0].lessons[1].teaches = [];
    await syncGrammar(prisma, edited);
    const after = await prisma.grammarPattern.findMany({ where: { courseId: await courseId(def) } });
    expect(after.map((r) => [r.slug, r.title, r.id])).toEqual([["um-verbs", "um verbs, revised", rows[0].id]]);
  });
});

describe("exercise export/import", () => {
  it("round-trips pattern tags", async () => {
    const def = courseWithPatterns();
    await syncCourseStructure(prisma, def);
    const skillSlug = def.units[0].skills[0].slug;
    const lesson = await prisma.lesson.findFirstOrThrow({
      where: { skill: { slug: skillSlug }, order: 1 },
      include: { exercises: { where: { status: "APPROVED" }, orderBy: { order: "asc" } } },
    });
    const patterns = await prisma.grammarPattern.findMany({ where: { courseId: await courseId(def) } });
    await prisma.exercisePattern.createMany({
      data: patterns.map((p) => ({ exerciseId: lesson.exercises[0].id, patternId: p.id })),
    });

    const written = await exportApprovedExercises(prisma, tmp);
    const file = JSON.parse(fs.readFileSync(path.join(tmp, "exercises", `${skillSlug}.json`), "utf8"));
    expect(file.lessons[0].exercises[0].patterns).toEqual(["mag-verbs", "um-verbs"]);
    expect(file.lessons[0].exercises[1].patterns).toEqual([]);

    // Re-import just that skill's file into a database that has lost its exercises.
    for (const f of written) if (path.basename(f) !== `${skillSlug}.json`) fs.rmSync(f);
    await prisma.exercise.deleteMany({ where: { lesson: { skill: { slug: skillSlug } } } });
    await importApprovedExercises(prisma, tmp);

    const tagged = await prisma.exercisePattern.findMany({ include: { exercise: true, pattern: true } });
    expect(tagged.map((t) => [t.exercise.lessonId, t.exercise.order, t.pattern.slug]).sort()).toEqual([
      [lesson.id, 1, "mag-verbs"],
      [lesson.id, 1, "um-verbs"],
    ]);

    // Put every skill's exercises back for the other test files.
    await prisma.exercise.deleteMany();
    await importApprovedExercises(prisma, CONTENT_DIR);
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
  const table = (completed: string[]): FormTable => ({
    infinitive: ["kumain"],
    completed,
    incompleted: ["kumakain"],
    contemplated: ["kakain"],
    recent: ["kakakain"],
  });

  it("draftVerbTables creates drafts and skips existing rows of any status", async () => {
    const def = courseWithVerbs(verb("kain", ["um", "in"]));
    await syncCourseStructure(prisma, def);
    const id = await courseId(def);

    const first = await draftVerbTables(prisma, def);
    expect(first).toMatchObject({ created: 2, unchanged: 0 });
    const um = await prisma.verbTable.findUniqueOrThrow({
      where: { courseId_root_affix: { courseId: id, root: "kain", affix: "um" } },
    });
    expect(um.status).toBe("DRAFT");
    expect(um.forms).toEqual(conjugate(def.units[0].skills[0].verbs[0], "um"));

    // A reviewed table must survive a re-run untouched.
    const reviewed = table(["kumain", "kinain"]);
    await prisma.verbTable.update({ where: { id: um.id }, data: { status: "APPROVED", forms: reviewed } });
    const second = await draftVerbTables(prisma, def);
    expect(second).toMatchObject({ created: 0, unchanged: 2 });
    const after = await prisma.verbTable.findUniqueOrThrow({ where: { id: um.id } });
    expect(after.status).toBe("APPROVED");
    expect(after.forms).toEqual(reviewed);
  });

  it("draftVerbTables skips combinations the engine cannot conjugate", async () => {
    const def = courseWithVerbs(verb("kain", ["um"]), verb("pst", ["um"]));
    await syncCourseStructure(prisma, def);
    const result = await draftVerbTables(prisma, def);
    expect(result).toMatchObject({ created: 1, unchanged: 0, skipped: ["pst/um"] });
  });

  /** The engine's own output for a verb, i.e. a table that needs no `irregular` marks. */
  const rule = (v: VerbEntry, affix: VerbEntry["affixes"][number]) => conjugate(v, affix);

  it("exports approved tables sorted by root then affix, and imports them back", async () => {
    const kain = verb("kain", ["um", "in"]);
    const basa = verb("basa", ["um"]);
    const def = courseWithVerbs(kain, basa);
    await syncCourseStructure(prisma, def);
    const id = await courseId(def);
    const irregularForms = { ...rule(kain, "um"), completed: ["kumain", "kinain"] };
    await prisma.verbTable.createMany({
      data: [
        { courseId: id, root: "kain", affix: "in", en: "eat", forms: rule(kain, "in"), status: "APPROVED" },
        {
          courseId: id,
          root: "kain",
          affix: "um",
          en: "eat",
          forms: irregularForms,
          status: "APPROVED",
          irregular: ["completed"],
          reviewNote: "variant kinain is common",
        },
        { courseId: id, root: "basa", affix: "um", en: "read", forms: rule(basa, "um"), status: "APPROVED" },
        {
          courseId: id,
          root: "luto",
          affix: "um",
          en: "cook",
          forms: rule(verb("luto", ["um"]), "um"),
          status: "DRAFT",
        },
      ],
    });

    const file = await exportVerbTables(prisma, tmp);
    expect(file).toBe(path.join(tmp, "grammar", "verbs.json"));
    const written = JSON.parse(fs.readFileSync(file!, "utf8"));
    expect(written.verbs.map((v: { root: string; affix: string }) => `${v.root}/${v.affix}`)).toEqual([
      "basa/um",
      "kain/um",
      "kain/in",
    ]);
    expect(written.verbs[1]).toMatchObject({ irregular: ["completed"], reviewNote: "variant kinain is common" });

    await prisma.verbTable.deleteMany();
    await importVerbTables(prisma, def, tmp);
    const rows = await prisma.verbTable.findMany({ orderBy: [{ root: "asc" }, { affix: "asc" }] });
    expect(rows.map((r) => [r.root, r.affix, r.status])).toEqual([
      ["basa", "um", "APPROVED"],
      ["kain", "um", "APPROVED"],
      ["kain", "in", "APPROVED"],
    ]);
    const kainUm = rows.find((r) => r.root === "kain" && r.affix === "um")!;
    expect(kainUm.forms).toEqual(irregularForms);
    expect(kainUm.irregular).toEqual(["completed"]);
    expect(kainUm.reviewNote).toBe("variant kinain is common");
    expect(kainUm.reviewedAt).not.toBeNull();

    // Importing again updates in place rather than failing on the unique key.
    await importVerbTables(prisma, def, tmp);
    expect(await prisma.verbTable.count()).toBe(3);
  });

  it("writes no file when nothing is approved", async () => {
    await syncCourseStructure(prisma, courseWithVerbs(verb("kain", ["um"])));
    expect(await exportVerbTables(prisma, tmp)).toBeNull();
    expect(fs.existsSync(path.join(tmp, "grammar"))).toBe(false);
  });

  describe("import", () => {
    const def = courseWithVerbs(verb("kain", ["um"]));
    const writeFile = (irregular: string[], completed: string[]) => {
      fs.mkdirSync(path.join(tmp, "grammar"));
      fs.writeFileSync(
        path.join(tmp, "grammar", "verbs.json"),
        JSON.stringify({
          verbs: [{ root: "kain", affix: "um", en: "eat", forms: table(completed), irregular, reviewNote: "" }],
        }),
      );
    };

    it("rejects a form that differs from the rule and is not marked irregular", async () => {
      writeFile([], ["kinain"]);
      await syncCourseStructure(prisma, def);
      await expect(importVerbTables(prisma, def, tmp)).rejects.toThrow(/kain.*um.*completed/);
      expect(await prisma.verbTable.count()).toBe(0);
    });

    it("accepts the same form once it is marked irregular", async () => {
      writeFile(["completed"], ["kinain"]);
      await syncCourseStructure(prisma, def);
      await importVerbTables(prisma, def, tmp);
      expect(await prisma.verbTable.count()).toBe(1);
    });

    it("matches a table on root and affix when two skills list the same root with different affixes", async () => {
      writeFile([], ["kumain"]);
      const both = courseWithVerbs(verb("kain", ["in"]));
      both.units[0].skills[1].verbs = [verb("kain", ["um"])];
      await syncCourseStructure(prisma, both);
      await expect(importVerbTables(prisma, both, tmp)).resolves.toBe(1);
    });

    it("rejects a table for a verb that is not in course.yaml", async () => {
      writeFile([], ["kumain"]);
      const other = courseWithVerbs(verb("basa", ["um"]));
      await syncCourseStructure(prisma, other);
      await expect(importVerbTables(prisma, other, tmp)).rejects.toThrow(/kain/);
    });

    it("does nothing when there is no verbs.json", async () => {
      await syncCourseStructure(prisma, def);
      await expect(importVerbTables(prisma, def, tmp)).resolves.toBe(0);
    });
  });
});

describe("generateDraftsForLesson with grammar", () => {
  const generatedRunIds: string[] = [];

  afterEach(async () => {
    // Drafts and runs created here must not leak into other test files (tags go with the exercises).
    await prisma.exercise.deleteMany({ where: { generationRunId: { in: generatedRunIds } } });
    await prisma.generationRun.deleteMany({ where: { OR: [{ id: { in: generatedRunIds } }, { model: "fake" }] } });
    generatedRunIds.length = 0;
  });

  /** The shipped course whose first lesson teaches um-verbs, with a kain/um frame to drill it. */
  function grammarCourse(): CourseDefinition {
    const def = courseWithPatterns();
    def.units[0].skills[0].verbs = [verb("kain", ["um"])];
    def.grammar[0].drills = { frames: [["___ ako.", "I ate.", "um", "completed"]], transforms: [], choices: [] };
    return def;
  }

  it("loads only the course's approved tables", async () => {
    const def = grammarCourse();
    await syncCourseStructure(prisma, def);
    await draftVerbTables(prisma, def);
    expect(await loadApprovedVerbTables(prisma, await courseId(def))).toEqual([]);

    await prisma.verbTable.updateMany({ data: { status: "APPROVED" } });
    expect(await loadApprovedVerbTables(prisma, await courseId(def))).toEqual([
      { root: "kain", affix: "um", en: "to kain", forms: conjugate(def.units[0].skills[0].verbs[0], "um") },
    ]);
  });

  it("tags the grammar drills it writes and builds them only from approved tables", async () => {
    const def = grammarCourse();
    await syncCourseStructure(prisma, def);
    await draftVerbTables(prisma, def);
    const target = { skillSlug: def.units[0].skills[0].slug, lessonOrder: 1 };
    const tagsOf = (runId: string) =>
      prisma.exercisePattern.findMany({
        where: { exercise: { generationRunId: runId } },
        include: { pattern: true, exercise: true },
      });

    // A DRAFT table is not reviewed yet: the lesson gets vocabulary drills only.
    const vocabulary = await generateDraftsForLesson(prisma, new StubGenerator(), def, target);
    generatedRunIds.push(vocabulary.runId);
    expect(await tagsOf(vocabulary.runId)).toEqual([]);

    await prisma.verbTable.updateMany({ data: { status: "APPROVED" } });
    const withGrammar = await generateDraftsForLesson(prisma, new StubGenerator(), def, target);
    generatedRunIds.push(withGrammar.runId);
    const tags = await tagsOf(withGrammar.runId);
    // The frame's conjugation, plus the paradigm every um- pattern gets; both tagged and still drafts.
    expect(tags.map((t) => [t.pattern.slug, t.exercise.type, t.exercise.status]).sort()).toEqual([
      ["um-verbs", "conjugate", "DRAFT"],
      ["um-verbs", "paradigm", "DRAFT"],
    ]);
    expect(withGrammar.created).toBe(vocabulary.created + 2);
    expect(withGrammar.rejected).toBe(0);
  });
  it("reports grammar rejections in the result and on the GenerationRun", async () => {
    const def = grammarCourse();
    def.grammar[0].drills.frames.push(["___ ako ng bulaklak.", "I ate a flower.", "um", "completed"]);
    await syncCourseStructure(prisma, def);
    await draftVerbTables(prisma, def);
    await prisma.verbTable.updateMany({ data: { status: "APPROVED" } });

    const result = await generateDraftsForLesson(prisma, new StubGenerator(), def, {
      skillSlug: def.units[0].skills[0].slug,
      lessonOrder: 1,
    });
    generatedRunIds.push(result.runId);
    expect(result.rejected).toBe(1);
    expect(result.rejectedReasons).toEqual([expect.stringMatching(/unknown word "bulaklak"/)]);
    const run = await prisma.generationRun.findUniqueOrThrow({ where: { id: result.runId } });
    expect(run.error).toMatch(/^1 item\(s\) failed validation: .*bulaklak/);
  });

  it("records a failed run and writes nothing when a draft names an unknown pattern", async () => {
    const def = grammarCourse();
    await syncCourseStructure(prisma, def);
    const skill = await prisma.skill.findUniqueOrThrow({ where: { slug: def.units[0].skills[0].slug } });
    const lesson = await prisma.lesson.findUniqueOrThrow({ where: { skillId_order: { skillId: skill.id, order: 1 } } });
    const before = await prisma.exercise.count({ where: { lessonId: lesson.id } });
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

    await expect(
      generateDraftsForLesson(prisma, generator, def, { skillSlug: skill.slug, lessonOrder: 1 }),
    ).rejects.toThrow(/no-such-pattern/);
    expect(await prisma.exercise.count({ where: { lessonId: lesson.id } })).toBe(before);
    const runs = await prisma.generationRun.findMany({ where: { model: "fake" } });
    expect(runs).toHaveLength(1);
    expect(runs[0].error).toMatch(/no-such-pattern/);
  });
});
