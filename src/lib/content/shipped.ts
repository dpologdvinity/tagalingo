/**
 * Checks for the course content that ships in the repo, without a database.
 *
 * `content/<lang>/exercises/*.json` is normally only validated when the seed imports it, so a
 * broken export would surface as a failed deploy. `checkShippedContent` runs the same rules as
 * `importApprovedExercises` (export format, skill and lesson exist in course.yaml, every payload
 * passes `parseExercise`) as a pure function, collects `lintExercise` warnings, and counts what
 * ships. The unit suite runs it on the real content and CI prints `formatContentReport` to the
 * job summary.
 */
import fs from "node:fs";
import path from "node:path";
import { z } from "zod";
import { loadCourseFile, type CourseDefinition } from "./course";
import { EXERCISE_TYPES, ExerciseValidationError, lintExercise, parseExercise, type ExerciseType } from "./schema";

/** One `content/<lang>/exercises/<skill>.json` file, as written by `exportApprovedExercises`. */
export const exportFileSchema = z.object({
  skill: z.string(),
  lessons: z.array(
    z.object({
      order: z.number().int().positive(),
      title: z.string(),
      exercises: z.array(
        z.object({
          type: z.enum(EXERCISE_TYPES),
          payload: z.unknown(),
          source: z.enum(["HUMAN", "CLAUDE", "STUB"]),
          reviewNote: z.string().nullish(),
        }),
      ),
    }),
  ),
});
export type ExportFile = z.infer<typeof exportFileSchema>;

/** Exercise counts for one skill. `lessons` is the number of lessons course.yaml defines. */
export type SkillContentStats = {
  slug: string;
  title: string;
  lessons: number;
  lessonsWithExercises: number;
  exercises: number;
  byType: Partial<Record<ExerciseType, number>>;
};

export type ShippedContentReport = {
  /** Problems that would make the seed fail or a learner see broken content. */
  errors: string[];
  /** Reviewer-facing `lintExercise` warnings; reported, never fatal. */
  warnings: string[];
  /** Every skill in course.yaml order, including skills with no shipped exercises yet. */
  skills: SkillContentStats[];
  totals: {
    files: number;
    lessons: number;
    lessonsWithExercises: number;
    exercises: number;
    byType: Partial<Record<ExerciseType, number>>;
  };
};

/** A file name plus its parsed-but-unvalidated JSON. */
export type RawContentFile = { name: string; raw: unknown };

const increment = <K extends string>(counts: Partial<Record<K, number>>, key: K) => {
  counts[key] = (counts[key] ?? 0) + 1;
};

/** Validate shipped exercise files against the course definition and count what they contain. */
export function checkShippedContent(course: CourseDefinition, files: RawContentFile[]): ShippedContentReport {
  const errors: string[] = [];
  const warnings: string[] = [];
  const skills = course.units.flatMap((u) => u.skills);
  const stats = new Map<string, SkillContentStats>(
    skills.map((s) => [
      s.slug,
      { slug: s.slug, title: s.title, lessons: s.lessons.length, lessonsWithExercises: 0, exercises: 0, byType: {} },
    ]),
  );
  const shippedIn = new Map<string, string>();

  for (const { name, raw } of files) {
    const parsed = exportFileSchema.safeParse(raw);
    if (!parsed.success) {
      const summary = parsed.error.issues.map((i) => `${i.path.join(".") || "file"}: ${i.message}`).join("; ");
      errors.push(`${name}: not a valid export file — ${summary}`);
      continue;
    }
    const file = parsed.data;
    const skill = stats.get(file.skill);
    if (!skill) {
      errors.push(`${name}: skill "${file.skill}" is not in course.yaml`);
      continue;
    }
    const earlier = shippedIn.get(file.skill);
    if (earlier) {
      errors.push(`${name}: skill "${file.skill}" is already shipped in ${earlier}`);
      continue;
    }
    shippedIn.set(file.skill, name);

    const seenOrders = new Set<number>();
    for (const lesson of file.lessons) {
      // The seed would import both copies into one lesson with clashing exercise orders.
      if (seenOrders.has(lesson.order)) {
        errors.push(`${name} › lesson ${lesson.order}: listed more than once`);
        continue;
      }
      seenOrders.add(lesson.order);
      if (lesson.order > skill.lessons) {
        errors.push(
          `${name} › lesson ${lesson.order}: "${file.skill}" only has ${skill.lessons} lessons in course.yaml`,
        );
        continue;
      }
      if (lesson.exercises.length) skill.lessonsWithExercises += 1;
      for (const [i, exercise] of lesson.exercises.entries()) {
        const where = `${name} › lesson ${lesson.order} › exercise ${i + 1}`;
        try {
          const ex = parseExercise(exercise.type, exercise.payload);
          for (const warning of lintExercise(ex)) warnings.push(`${where}: ${warning}`);
          skill.exercises += 1;
          increment(skill.byType, ex.type);
        } catch (err) {
          if (!(err instanceof ExerciseValidationError)) throw err;
          errors.push(`${where}: ${err.message}`);
        }
      }
    }
  }

  const all = [...stats.values()];
  const byType: Partial<Record<ExerciseType, number>> = {};
  for (const s of all)
    for (const [type, n] of Object.entries(s.byType))
      byType[type as ExerciseType] = (byType[type as ExerciseType] ?? 0) + n;
  return {
    errors,
    warnings,
    skills: all,
    totals: {
      files: files.length,
      lessons: all.reduce((n, s) => n + s.lessons, 0),
      lessonsWithExercises: all.reduce((n, s) => n + s.lessonsWithExercises, 0),
      exercises: all.reduce((n, s) => n + s.exercises, 0),
      byType,
    },
  };
}

/** Read `<contentDir>/course.yaml` and every `<contentDir>/exercises/*.json`, then check them. */
export function loadShippedContent(contentDir: string): ShippedContentReport {
  const course = loadCourseFile(path.join(contentDir, "course.yaml"));
  const dir = path.join(contentDir, "exercises");
  const names = fs.existsSync(dir)
    ? fs
        .readdirSync(dir)
        .filter((f) => f.endsWith(".json"))
        .sort()
    : [];
  const files: RawContentFile[] = [];
  const unreadable: string[] = [];
  for (const name of names) {
    try {
      files.push({ name, raw: JSON.parse(fs.readFileSync(path.join(dir, name), "utf8")) });
    } catch (err) {
      unreadable.push(`${name}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }
  const report = checkShippedContent(course, files);
  report.errors.unshift(...unreadable);
  return report;
}

/** Markdown summary of a report: per-skill table, exercise types, then errors and warnings. */
export function formatContentReport(report: ShippedContentReport): string {
  const { totals } = report;
  const lines = [
    "## Course content",
    "",
    `${totals.exercises} approved exercises across ${totals.lessonsWithExercises} of ${totals.lessons} lessons` +
      ` (${totals.files} exercise files).`,
    "",
    "| Skill | Lessons with exercises | Exercises |",
    "| --- | --- | --- |",
    ...report.skills.map((s) => `| ${s.title} | ${s.lessonsWithExercises} / ${s.lessons} | ${s.exercises} |`),
    `| **Total** | **${totals.lessonsWithExercises} / ${totals.lessons}** | **${totals.exercises}** |`,
    "",
    "| Exercise type | Count |",
    "| --- | --- |",
    ...EXERCISE_TYPES.filter((t) => totals.byType[t]).map((t) => `| ${t} | ${totals.byType[t]} |`),
  ];
  if (report.errors.length) {
    lines.push("", `### ❌ ${report.errors.length} errors`, "", ...report.errors.map((e) => `- ${e}`));
  }
  if (report.warnings.length) {
    lines.push(
      "",
      `<details><summary>⚠️ ${report.warnings.length} reviewer warnings</summary>`,
      "",
      ...report.warnings.map((w) => `- ${w}`),
      "",
      "</details>",
    );
  }
  return lines.join("\n") + "\n";
}
