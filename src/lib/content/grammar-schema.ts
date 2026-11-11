/**
 * Zod schemas for the grammar half of course.yaml: grammar patterns (the cards learners read plus
 * the drill ingredients the stub generator turns into exercises) and per-skill verb entries.
 *
 * These schemas check each entry on its own. Checks that need the whole course (a pattern is taught
 * by exactly one lesson, `requires` never points forward, ...) live in `course.ts`.
 */
import { z } from "zod";
import { normalizeAnswer } from "../normalize";
import { AFFIXES, VERB_FORMS, type Affix } from "../grammar/types";

const text = z.string().trim().min(1);

/** `z.enum` needs a non-empty tuple type; AFFIXES is one at runtime, just typed as a plain array. */
const affixSchema = z.enum(AFFIXES as unknown as readonly [Affix, ...Affix[]]);
const formSchema = z.enum(VERB_FORMS);

const BLANK = "___";
const blankCount = (sentence: string) => sentence.split(BLANK).length - 1;

/**
 * Conjugation drill: a sentence with one blank, its English, and the affix/form that fills it.
 * `root` pins the verb; omitted, any approved verb with that affix in the lesson can fill it.
 */
const frameSchema = z
  .tuple([text, text, affixSchema, formSchema, text.optional()])
  .refine(([s]) => blankCount(s) === 1, {
    message: `a frame sentence needs exactly one blank (${BLANK})`,
  });

/** Transformation drill: source sentence, its English, the instruction, and every accepted answer. */
const transformSchema = z.tuple([text, text, text, z.array(text).min(1)]);

/**
 * Multiple-choice drill: sentence with one blank, English, 2-4 options, the right index, and one
 * explanation per option (`null` exactly at the right index; wrong options must say why).
 */
const choiceSchema = z
  .tuple([text, text, z.array(text).min(2).max(4), z.number().int().min(0), z.array(text.nullable())])
  .superRefine(([sentence, , options, answerIndex, why], ctx) => {
    const fail = (message: string) => ctx.addIssue({ code: "custom", message });
    if (blankCount(sentence) !== 1) fail(`a choice sentence needs exactly one blank (${BLANK})`);
    if (answerIndex >= options.length)
      return fail(`answer index ${answerIndex} is outside the ${options.length} options`);
    if (why.length !== options.length) return fail(`why has ${why.length} entries for ${options.length} options`);
    why.forEach((reason, i) => {
      if (i === answerIndex && reason !== null) fail(`why must be null at the answer index (${i})`);
      if (i !== answerIndex && reason === null) fail(`why is missing an explanation for wrong option "${options[i]}"`);
    });
  });

const tableSchema = z
  .object({ head: z.array(text).min(1), rows: z.array(z.array(text)).min(1) })
  .refine((t) => t.rows.every((r) => r.length === t.head.length), {
    message: "every table row needs as many cells as the table head",
  });

/** One grammar pattern: the card learners read plus the ingredients for its drills. */
export const patternSchema = z
  .object({
    /** Kebab-case, unique across the course; lessons refer to it from `teaches` and `uses`. */
    id: z.string().regex(/^[a-z0-9]+(-[a-z0-9]+)*$/),
    title: text,
    rule: text,
    table: tableSchema.optional(),
    /** [tagalog, english]; two or three. */
    examples: z
      .array(z.tuple([text, text]))
      .min(2)
      .max(3),
    notes: z.array(text).default([]),
    /** [wrong answer, explanation]. */
    mistakes: z.array(z.tuple([text, text])).default([]),
    /** Ids of patterns learners should already know; they must be taught earlier in the course. */
    requires: z.array(text).default([]),
    drills: z
      .object({
        frames: z.array(frameSchema).default([]),
        transforms: z.array(transformSchema).default([]),
        choices: z.array(choiceSchema).default([]),
      })
      .default({ frames: [], transforms: [], choices: [] }),
  })
  .superRefine((p, ctx) => {
    // A "common mistake" that is actually a right answer would teach the wrong thing.
    const right = new Set([
      ...p.examples.map(([tl]) => normalizeAnswer(tl)),
      ...p.drills.transforms.flatMap(([, , , answers]) => answers.map(normalizeAnswer)),
    ]);
    p.mistakes.forEach(([wrong], i) => {
      if (right.has(normalizeAnswer(wrong)))
        ctx.addIssue({
          code: "custom",
          path: ["mistakes", i],
          message: `mistake "${wrong}" is identical to a correct example or drill answer`,
        });
    });
  });

export type CoursePattern = z.infer<typeof patternSchema>;
export type Frame = z.infer<typeof frameSchema>;
export type Transform = z.infer<typeof transformSchema>;
export type Choice = z.infer<typeof choiceSchema>;

/** The card shown to learners; the only part of a pattern that client components may import. */
export type PatternCard = Pick<CoursePattern, "title" | "rule" | "table" | "examples" | "notes" | "mistakes">;

/** Lower-case roots, optionally hyphenated (e.g. "pa-bili"); no padding or capitals. */
const rootSchema = z.string().regex(/^[a-z]+(-[a-z]+)?$/);

/** Each override cell lists the canonical form first, then accepted variants; it can't be empty. */
const overrideCell = z.array(text).min(1);

/** A verb as authored under a skill's `verbs:`; mirrors `VerbEntry` in `grammar/types.ts`. */
export const verbEntrySchema = z.object({
  root: rootSchema,
  en: text,
  affixes: z.array(affixSchema).min(1),
  /** The root ends in an unwritten glottal stop: luto -> lutuin, not lutuhin. */
  glottal: z.boolean().default(false),
  /** Syncopated stem before -in/-an when the root contracts, e.g. bili -> "bilh". */
  stem: rootSchema.nullable().default(null),
  forms: z.partialRecord(affixSchema, z.partialRecord(formSchema, overrideCell)).default({}),
});
