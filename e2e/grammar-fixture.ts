/**
 * E2E fixture for the grammar player: one unit/skill/lesson at the start of the course, one grammar
 * pattern taught by that lesson, two approved verb tables (e2ekain/um, which the exercises drill, and
 * e2ekilala/ma, so Tala's stub reply "makilala" is a known verb form), one DRAFT table (e2ekain/mag,
 * for the Studio review specs) and four approved exercises (conjugate, paradigm, find_root, transform)
 * tagged with the pattern. Everything is inserted with SQL under `e2e-grammar-` ids and made-up
 * `e2e...` verb roots, so it can sit next to the course's real grammar content without colliding with
 * it (verb tables are unique on course + root + affix) and removing it leaves the real rows alone.
 * The tables spell their forms like real ones (kumain...), so the specs read naturally, but their roots
 * are the fixture's: scope every locator to the fixture pattern, skill or root, because a real card or
 * table may show the same text. `removeGrammarFixture`
 * deletes the unit (cascading to skill, lesson, exercises, pattern and tags) and the verb tables, so
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
  patternSlug: `${P}pattern`,
  skillSlug: `${P}skill`,
  skillTitle: "E2E verbs",
  /** The root the exercises drill (verb table e2ekain/um) and the DRAFT table (e2ekain/mag). */
  verbRoot: "e2ekain",
  /** The root whose table makes Tala's "makilala" a known verb form. */
  lookupRoot: "e2ekilala",
  /** The DRAFT e2ekain/mag table; the Studio specs approve it. */
  draftTableId: `${P}verb-draft`,
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
    rows: [
      ["kain", "kumain", "kumakain", "kakain"],
      ["basa", "bumasa", "bumabasa", "babasa"],
      ["inom", "uminom", "umiinom", "iinom"],
      ["lakad", "lumakad", "lumalakad", "lalakad"],
    ],
  },
  // Long on purpose: the specs check that a tall card opens at its title on a phone, not at its button.
  examples: [
    ["Kumain ako ng kanin.", "I ate rice."],
    ["Kumakain siya ngayon.", "He is eating now."],
    ["Kakain kami bukas.", "We will eat tomorrow."],
  ],
  notes: [
    "Roots that start with a vowel take um- in front.",
    "The past and the infinitive look the same, so the sentence tells you which one you are reading.",
    "The present repeats the first syllable of the root after the um- has gone in.",
    "The future repeats the first syllable of the root and drops the um- altogether.",
    "Say the three forms aloud a few times; the rhythm of the repeated syllable is what makes the present and future easy to hear.",
  ],
  mistakes: [],
};

const VERB_FORMS = {
  infinitive: ["kumain"],
  completed: ["kumain"],
  incompleted: ["kumakain"],
  contemplated: ["kakain"],
  recent: ["kakakain"],
};

const KILALA_FORMS = {
  infinitive: ["makilala"],
  completed: ["nakilala"],
  incompleted: ["nakikilala"],
  contemplated: ["makikilala"],
  recent: ["kakikilala"],
};

const DRAFT_FORMS = {
  infinitive: ["magkain"],
  completed: ["nagkain"],
  incompleted: ["nagkakain"],
  contemplated: ["magkakain"],
  recent: ["kakakain"],
};

const EXERCISES = [
  [
    FIXTURE.exercises.conjugate,
    "conjugate",
    {
      sentence: "___ ako ng kanin kahapon.",
      translation: "I ate rice yesterday.",
      root: FIXTURE.verbRoot,
      affix: "um",
      form: "completed",
      answers: ["kumain"],
    },
  ],
  [
    FIXTURE.exercises.paradigm,
    "paradigm",
    {
      root: FIXTURE.verbRoot,
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
      options: [FIXTURE.verbRoot, "kuma", "akain"],
      root: FIXTURE.verbRoot,
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
    `insert into "Unit" (id, "courseId", "order", slug, title, subtitle, color) values ($1, $2, $3, $4, 'E2E grammar', 'Fixture', '#0F8287')`,
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
    `insert into "VerbTable" (id, "courseId", root, affix, en, forms, status) values ($1, $2, $3, 'um', 'to eat', $4, 'APPROVED')`,
    [`${P}verb`, course.id, FIXTURE.verbRoot, JSON.stringify(VERB_FORMS)],
  );
  await query(
    `insert into "VerbTable" (id, "courseId", root, affix, en, forms, status) values ($1, $2, $3, 'ma', 'to know (someone)', $4, 'APPROVED')`,
    [`${P}verb-kilala`, course.id, FIXTURE.lookupRoot, JSON.stringify(KILALA_FORMS)],
  );
  await query(
    `insert into "VerbTable" (id, "courseId", root, affix, en, forms, status) values ($1, $2, $3, 'mag', 'to feed', $4, 'DRAFT')`,
    [FIXTURE.draftTableId, course.id, FIXTURE.verbRoot, JSON.stringify(DRAFT_FORMS)],
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
  await query(`delete from "VerbTable" where id like $1`, [`${P}verb%`]);
}
