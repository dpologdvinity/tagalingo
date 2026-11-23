/**
 * Database side of the grammar engine: pattern sync, verb-table drafting, and moving reviewed verb
 * tables between the database and content/<lang>/grammar/verbs.json.
 *
 *   course.yaml `grammar`   --syncGrammar-->      GrammarPattern rows
 *   course.yaml `verbs`     --draftVerbTables-->  VerbTable rows (DRAFT, from the engine's rules)
 *   VerbTable (APPROVED)    --exportVerbTables--> grammar/verbs.json  --importVerbTables--> VerbTable
 *
 * Like `persist.ts` these take a PrismaClient so the seed and CLI scripts can use them directly.
 * The file format itself is defined once, in `lib/grammar/verbs-file.ts`.
 */
import fs from "node:fs";
import path from "node:path";
import type { PrismaClient } from "@/generated/prisma/client";
import { diffFromRule, type VerbTableData } from "@/lib/grammar/analyse";
import { conjugate } from "@/lib/grammar/morphology";
import { AFFIXES, type FormTable, type VerbEntry } from "@/lib/grammar/types";
import {
  readVerbFile,
  verbFileEntrySchema,
  verbFileSchema,
  verbsFilePath,
  type VerbFileEntry,
} from "@/lib/grammar/verbs-file";
import type { CourseDefinition } from "./course";

/**
 * Upsert the course's grammar patterns (by course + slug) and delete the ones no longer in
 * course.yaml; their progress, exercise tags and flags go with them (cascade). Needs the course
 * structure synced first, because each pattern points at the lesson that teaches it.
 */
export async function syncGrammar(prisma: PrismaClient, def: CourseDefinition): Promise<void> {
  const course = await prisma.course.findUniqueOrThrow({ where: { slug: def.course.slug } });
  const lessons = await prisma.lesson.findMany({
    where: { skill: { unit: { courseId: course.id } } },
    include: { skill: true },
  });
  const lessonId = new Map(lessons.map((l) => [`${l.skill.slug}:${l.order}`, l.id]));

  // A pattern's teaching lesson is the one whose `teaches` lists it (course.yaml validation
  // guarantees exactly one).
  const teacher = new Map<string, string>();
  for (const skill of def.units.flatMap((u) => u.skills))
    skill.lessons.forEach((lesson, li) => lesson.teaches.forEach((id) => teacher.set(id, `${skill.slug}:${li + 1}`)));

  for (const [i, p] of def.grammar.entries()) {
    const key = teacher.get(p.id);
    const teachingLesson = key && lessonId.get(key);
    if (!teachingLesson) throw new Error(`Pattern "${p.id}" is not taught by any lesson in the database`);
    // The card is what learners read; requires and drills stay in course.yaml. The JSON round trip
    // drops an absent `table` instead of storing undefined.
    const card = { rule: p.rule, table: p.table, examples: p.examples, notes: p.notes, mistakes: p.mistakes };
    const data = {
      order: i + 1,
      title: p.title,
      card: JSON.parse(JSON.stringify(card)) as object,
      lessonId: teachingLesson,
    };
    await prisma.grammarPattern.upsert({
      where: { courseId_slug: { courseId: course.id, slug: p.id } },
      create: { courseId: course.id, slug: p.id, ...data },
      update: data,
    });
  }
  await prisma.grammarPattern.deleteMany({
    where: { courseId: course.id, slug: { notIn: def.grammar.map((p) => p.id) } },
  });
}

/** Every verb in course.yaml, across all skills. */
export const courseVerbs = (def: CourseDefinition): VerbEntry[] =>
  def.units.flatMap((u) => u.skills.flatMap((s) => s.verbs));

/**
 * Create a DRAFT table from the engine's rules for every course verb × affix, for a reviewer to
 * correct and approve. A row that already exists, whatever its status, is left alone (`unchanged`),
 * so re-running never overwrites reviewed work. Combinations the engine cannot conjugate (it throws,
 * e.g. a root with no vowel) are listed in `skipped` as "root/affix" rather than failing the run.
 */
export async function draftVerbTables(
  prisma: PrismaClient,
  def: CourseDefinition,
): Promise<{ created: number; unchanged: number; skipped: string[] }> {
  const course = await prisma.course.findUniqueOrThrow({ where: { slug: def.course.slug } });
  let created = 0;
  let unchanged = 0;
  const skipped: string[] = [];
  for (const verb of courseVerbs(def)) {
    for (const affix of verb.affixes) {
      const where = { courseId_root_affix: { courseId: course.id, root: verb.root, affix } };
      if (await prisma.verbTable.findUnique({ where, select: { id: true } })) {
        unchanged++;
        continue;
      }
      let forms: FormTable;
      try {
        forms = conjugate(verb, affix);
      } catch {
        skipped.push(`${verb.root}/${affix}`);
        continue;
      }
      await prisma.verbTable.create({
        data: { courseId: course.id, root: verb.root, affix, en: verb.en, forms, status: "DRAFT" },
      });
      created++;
    }
  }
  return { created, unchanged, skipped };
}

/**
 * The course's APPROVED verb tables as the analyser and the generators see them, sorted by root then
 * affix; pass `root` to load only that verb's tables (answer grading does). Rows are parsed with the
 * same schema as `verbs.json`, so a hand-edited row that is not a valid table fails loudly here
 * instead of producing drills from garbage. Takes any client with `verbTable`, so a transaction works.
 */
export async function loadApprovedVerbTables(
  prisma: Pick<PrismaClient, "verbTable">,
  courseId: string,
  root?: string,
): Promise<VerbTableData[]> {
  const rows = await prisma.verbTable.findMany({ where: { courseId, status: "APPROVED", root } });
  return rows
    .map(({ root, affix, en, forms }) => ({ root, affix, en, forms: verbFileEntrySchema.shape.forms.parse(forms) }))
    .sort((a, b) => (a.root < b.root ? -1 : a.root > b.root ? 1 : AFFIXES.indexOf(a.affix) - AFFIXES.indexOf(b.affix)));
}

/**
 * Write the course's APPROVED tables to `<contentDir>/grammar/verbs.json`, sorted by root then affix,
 * and return the path. Writes nothing (returns null) when nothing is approved and no file exists yet,
 * so an empty course doesn't gain a placeholder file. When nothing is approved but the file already
 * lists tables it throws instead of emptying it (a sign of the wrong database), unless `force` is set.
 *
 * Every table must also pass the checks `importVerbTables` runs against `def` (its verb and affix are
 * in course.yaml, and only `irregular` forms differ from the rules). Otherwise it throws, naming each
 * stale row, and writes nothing: the seed would reject the file only after wiping the database.
 */
export async function exportVerbTables(
  prisma: PrismaClient,
  def: CourseDefinition,
  contentDir: string,
  { force = false }: { force?: boolean } = {},
): Promise<string | null> {
  const course = await prisma.course.findUniqueOrThrow({ where: { slug: def.course.slug } });
  const rows = await prisma.verbTable.findMany({ where: { courseId: course.id, status: "APPROVED" } });
  const file = verbsFilePath(contentDir);
  if (!rows.length && !fs.existsSync(file)) return null;
  if (!rows.length && !force) {
    // An unreadable file has nothing worth protecting; `readVerbFile` throws on it.
    let existing = 0;
    try {
      existing = readVerbFile(contentDir).length;
    } catch {
      existing = 0;
    }
    if (existing)
      throw new Error(
        `The database has no approved verb tables, but ${file} lists ${existing}. ` +
          `Exporting would empty it. Check that DATABASE_URL points at the reviewed database, or pass --force.`,
      );
  }

  const verbs = rows
    .map((r) => ({
      root: r.root,
      affix: r.affix,
      en: r.en,
      forms: r.forms,
      irregular: r.irregular,
      reviewNote: r.reviewNote ?? "",
    }))
    .sort((a, b) => (a.root < b.root ? -1 : a.root > b.root ? 1 : AFFIXES.indexOf(a.affix) - AFFIXES.indexOf(b.affix)));
  // Parsing and checking on the way out means the database can never write a file the import would reject.
  const data = verbFileSchema.parse({ verbs });
  const stale = data.verbs.flatMap((row) => {
    try {
      return unmarkedIrregulars(def, [row], "database");
    } catch (err) {
      return [err instanceof Error ? err.message : String(err)];
    }
  });
  if (stale.length)
    throw new Error(
      `Not exporting ${file}: ${stale.length} approved verb table(s) would fail the seed import. ` +
        `Fix or unapprove them, or restore the verb in course.yaml:\n  ${stale.join("\n  ")}`,
    );
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(data, null, 2) + "\n");
  return file;
}

/**
 * The course's entry for a table row, or an error naming the row (prefixed with `source`, where the
 * row came from) when course.yaml has no such verb/affix. The same root may be listed in several
 * skills with different affixes, so the match is on root and affix together.
 */
export function entryFor(
  verbs: VerbEntry[],
  row: Pick<VerbFileEntry, "root" | "affix">,
  source = "verbs.json",
): VerbEntry {
  const sameRoot = verbs.filter((v) => v.root === row.root);
  if (!sameRoot.length) throw new Error(`${source}: "${row.root}" (${row.affix}) is not a verb in course.yaml`);
  const verb = sameRoot.find((v) => v.affixes.includes(row.affix));
  if (!verb) throw new Error(`${source}: course.yaml does not list the affix "${row.affix}" for "${row.root}"`);
  return verb;
}

/**
 * One message per row of verbs.json whose cells differ from the engine's rule output in a form the
 * row does not list as `irregular` (an unreviewed typo). Throws, like `entryFor`, for a row whose
 * verb or affix is not in course.yaml. Messages start with `source`, where the rows came from. Pure,
 * so CI can check the shipped file without a database.
 */
export function unmarkedIrregulars(
  def: CourseDefinition,
  rows: readonly VerbFileEntry[],
  source = "verbs.json",
): string[] {
  const verbs = courseVerbs(def);
  return rows.flatMap((row) => {
    const unmarked = diffFromRule(entryFor(verbs, row, source), row.affix, row.forms).filter(
      (f) => !row.irregular.includes(f),
    );
    return unmarked.length
      ? [
          `${source}: ${row.root} (${row.affix}) differs from the rules in ${unmarked.join(", ")} but is not marked irregular`,
        ]
      : [];
  });
}

/**
 * Upsert every table in `<contentDir>/grammar/verbs.json` as APPROVED and return how many were
 * imported (0 when the file is absent). A cell that differs from the engine's rule output must be
 * named in the row's `irregular` list, otherwise it is an unreviewed typo: the whole import is then
 * rejected before anything is written. The rule output is computed from course.yaml's verb entry
 * (glottal stop, stem, overrides), so `def` must be the same course the file was exported from.
 */
export async function importVerbTables(
  prisma: PrismaClient,
  def: CourseDefinition,
  contentDir: string,
  reviewedById?: string,
): Promise<number> {
  const rows = readVerbFile(contentDir);
  const unmarked = unmarkedIrregulars(def, rows);
  if (unmarked.length) throw new Error(unmarked[0]);
  if (!rows.length) return 0;

  const course = await prisma.course.findUniqueOrThrow({ where: { slug: def.course.slug } });
  const reviewedAt = new Date();
  await prisma.$transaction(
    rows.map((row) => {
      const data = {
        en: row.en,
        forms: row.forms,
        status: "APPROVED" as const,
        irregular: row.irregular,
        reviewNote: row.reviewNote || null,
        reviewedById: reviewedById ?? null,
        reviewedAt,
      };
      return prisma.verbTable.upsert({
        where: { courseId_root_affix: { courseId: course.id, root: row.root, affix: row.affix } },
        create: { courseId: course.id, root: row.root, affix: row.affix, ...data },
        update: data,
      });
    }),
  );
  return rows.length;
}
