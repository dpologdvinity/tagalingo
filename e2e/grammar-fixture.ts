/**
 * E2E fixture for the grammar player: one unit/skill/lesson at the start of the course, one grammar
 * pattern taught by that lesson, one approved verb table and four approved exercises (conjugate,
 * paradigm, find_root, transform) tagged with the pattern. Everything is inserted with SQL under
 * `e2e-grammar-` ids, because the dev database has no grammar content. `removeGrammarFixture`
 * deletes the unit (cascading to skill, lesson, exercises, pattern and tags) and the verb table, so
 * it is safe to call from `afterAll` even after a failed run.
 *
 * The unit goes first, not last: the path unlocks skills strictly in order and a "coming soon" skill
 * (lessons still without approved exercises) blocks everything after it, so a fixture at the end
 * could never be opened. As the first skill its lesson is open to every new learner.
 *
 * Payloads and the card are validated with the app's own schemas before insertion, so a drift in
 * either shows up here instead of as a puzzling UI failure.
 */
import { parseExercise } from "../src/lib/content/schema";
import { patternCardSchema } from "../src/lib/content/grammar-schema";
import { query } from "./helpers";

const P = "e2e-grammar-";

export const FIXTURE = {
  lessonId: `${P}lesson`,
  patternTitle: "Um verbs (e2e)",
  /** Exercise ids in lesson order. */
  exercises: {
    conjugate: `${P}conjugate`,
    paradigm: `${P}paradigm`,
    findRoot: `${P}find-root`,
    transform: `${P}transform`,
  },
} as const;

const CARD = {
  rule: "Put -um- after the first consonant to say what someone did.",
  table: {
    head: ["Root", "Past", "Present", "Future"],
    rows: [["kain", "kumain", "kumakain", "kakain"]],
  },
  examples: [
    ["Kumain ako ng kanin.", "I ate rice."],
    ["Kumakain siya ngayon.", "He is eating now."],
  ],
  notes: ["Roots that start with a vowel take um- in front."],
  mistakes: [],
};

const VERB_FORMS = {
  infinitive: ["kumain"],
  completed: ["kumain"],
  incompleted: ["kumakain"],
  contemplated: ["kakain"],
  recent: ["kakakain"],
};

const EXERCISES = [
  [
    FIXTURE.exercises.conjugate,
    "conjugate",
    {
      sentence: "___ ako ng kanin kahapon.",
      translation: "I ate rice yesterday.",
      root: "kain",
      affix: "um",
      form: "completed",
      answers: ["kumain"],
    },
  ],
  [
    FIXTURE.exercises.paradigm,
    "paradigm",
    {
      root: "kain",
      affix: "um",
      en: "to eat",
      cells: [
        { form: "infinitive", value: "kumain", hidden: false },
        { form: "completed", value: "kumain", hidden: false },
        { form: "incompleted", value: "kumakain", hidden: true },
        { form: "contemplated", value: "kakain", hidden: true },
      ],
      distractors: ["kumaen"],
    },
  ],
  [
    FIXTURE.exercises.findRoot,
    "find_root",
    {
      word: "kumakain",
      translation: "eating",
      mode: "choice",
      options: ["kain", "kuma", "akain"],
      root: "kain",
      hint: "Drop -um- and the repeated ka: kumakain is kain.",
    },
  ],
  [
    FIXTURE.exercises.transform,
    "transform",
    {
      source: "Kumain ako ng kanin.",
      sourceEn: "I ate rice.",
      instruction: "Make it future",
      mode: "build",
      answers: [["Kakain", "ako", "ng", "kanin."]],
      distractors: ["Kumakain"],
    },
  ],
] as const;

/** Insert the fixture; any leftovers from an aborted run are removed first. */
export async function createGrammarFixture(): Promise<void> {
  patternCardSchema.parse(CARD);
  for (const [, type, payload] of EXERCISES) parseExercise(type, payload);

  await removeGrammarFixture();
  const [course] = await query<{ id: string; next: number }>(
    `select c.id, coalesce(min(u."order"), 1) - 1 as next from "Course" c left join "Unit" u on u."courseId" = c.id group by c.id limit 1`,
  );
  await query(
    `insert into "Unit" (id, "courseId", "order", slug, title, subtitle, color) values ($1, $2, $3, $4, 'E2E grammar', 'Fixture', '#13a3a9')`,
    [`${P}unit`, course.id, course.next, `${P}unit`],
  );
  await query(
    `insert into "Skill" (id, "unitId", "order", slug, title, emoji, description) values ($1, $2, 1, $1, 'E2E verbs', '🧪', 'Fixture skill')`,
    [`${P}skill`, `${P}unit`],
  );
  await query(`insert into "Lesson" (id, "skillId", "order", title) values ($1, $2, 1, 'E2E verbs 1')`, [
    FIXTURE.lessonId,
    `${P}skill`,
  ]);
  await query(
    `insert into "GrammarPattern" (id, "courseId", slug, "order", title, card, "lessonId") values ($1, $2, $1, 9999, $3, $4, $5)`,
    [`${P}pattern`, course.id, FIXTURE.patternTitle, JSON.stringify(CARD), FIXTURE.lessonId],
  );
  await query(
    `insert into "VerbTable" (id, "courseId", root, affix, en, forms, status) values ($1, $2, 'kain', 'um', 'to eat', $3, 'APPROVED')`,
    [`${P}verb`, course.id, JSON.stringify(VERB_FORMS)],
  );
  for (const [i, [id, type, payload]] of EXERCISES.entries()) {
    await query(
      `insert into "Exercise" (id, "lessonId", "order", type, payload, status, source, "updatedAt") values ($1, $2, $3, $4::"ExerciseType", $5, 'APPROVED', 'HUMAN', now())`,
      [id, FIXTURE.lessonId, i + 1, type, JSON.stringify(payload)],
    );
    await query(`insert into "ExercisePattern" ("exerciseId", "patternId") values ($1, $2)`, [id, `${P}pattern`]);
  }
}

/** Delete the fixture rows (a no-op when they are not there). */
export async function removeGrammarFixture(): Promise<void> {
  await query(`delete from "Unit" where id = $1`, [`${P}unit`]);
  await query(`delete from "VerbTable" where id = $1`, [`${P}verb`]);
}
