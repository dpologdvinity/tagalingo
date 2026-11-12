/**
 * Exercise payload schemas and content lint.
 *
 * Every Exercise row stores a type-specific JSON `payload`. This module is the single source
 * of truth for what those payloads look like: the seed, the generators (Claude + stub), the
 * Studio editor and the grader all go through `parseExercise`, so malformed content can never
 * reach a learner.
 *
 * `lintExercise` adds softer, human-facing warnings (duplicate options, distractors that are
 * also valid answers, …) that are shown to reviewers but do not block saving.
 */
import { z } from "zod";
import { AFFIXES, VERB_FORMS, type Affix } from "@/lib/grammar/types";

const fold = (s: string) => s.trim().toLocaleLowerCase();

export const EXERCISE_TYPES = [
  "select_translation",
  "word_bank",
  "match_pairs",
  "fill_blank",
  "type_translation",
  "listen_select",
  "speak",
  "dialogue",
  "conjugate",
  "find_root",
  "transform",
  "paradigm",
] as const;
export type ExerciseType = (typeof EXERCISE_TYPES)[number];

const text = z.string().trim().min(1);
const lang = z.enum(["tl", "en"]);

/**
 * Optional per-option explanation shown after a wrong pick. Same length as `options`, with null at
 * the correct option. Server-only: never sent to the client.
 */
const why = z.array(z.string().trim().min(1).nullable()).optional();

/** Optional explanations for specific wrong typed/built answers. Server-only. */
const mistakes = z.array(z.object({ answer: text, why: text })).optional();

type WhyCheck = { options: string[]; answerIndex: number; why?: (string | null)[] | undefined };
/** `why` must line up with `options` and be null at the correct option. */
const whyAligned = {
  check: (p: WhyCheck) =>
    !p.why || (p.why.length === p.options.length && p.why.every((w, i) => (i === p.answerIndex ? w === null : true))),
  params: { message: "why must match options in length and be null at answerIndex", path: ["why"] },
};

/** Pick the correct translation of `prompt` among `options`. */
const selectTranslation = z
  .object({
    prompt: text,
    promptLang: lang,
    options: z.array(text).min(2).max(4),
    answerIndex: z.number().int().min(0),
    hint: text.optional(),
    why,
  })
  .refine((p) => p.answerIndex < p.options.length, {
    message: "answerIndex must point at one of the options",
    path: ["answerIndex"],
  })
  .refine(whyAligned.check, whyAligned.params);

/** Build the translation of `prompt` by tapping tiles: answer tokens + distractors, shuffled. */
const wordBank = z.object({
  prompt: text,
  promptLang: lang,
  answer: z.array(text).min(1).max(12),
  /** Other token sequences that are also correct (e.g. different word order). */
  alternates: z.array(z.array(text).min(1)).optional(),
  distractors: z.array(text).max(6),
  mistakes,
});

/** Match each Tagalog word to its English meaning. */
const matchPairs = z.object({
  pairs: z
    .array(z.object({ tl: text, en: text }))
    .min(3)
    .max(5),
});

/** Choose the word that completes a Tagalog `sentence` containing exactly one `___`. */
const fillBlank = z
  .object({
    sentence: text,
    translation: text,
    options: z.array(text).min(2).max(4),
    answerIndex: z.number().int().min(0),
    why,
  })
  .refine((p) => p.sentence.split("___").length === 2, {
    message: "sentence must contain exactly one ___ blank",
    path: ["sentence"],
  })
  .refine((p) => p.answerIndex < p.options.length, {
    message: "answerIndex must point at one of the options",
    path: ["answerIndex"],
  })
  .refine(whyAligned.check, whyAligned.params);

/** Type the translation of `prompt`; any entry in `answers` is accepted. */
const typeTranslation = z.object({
  prompt: text,
  promptLang: lang,
  answers: z.array(text).min(1),
  mistakes,
});

/** Hear a Tagalog phrase (text-to-speech), then pick its meaning. */
const listenSelect = z
  .object({
    audio: text,
    options: z.array(text).min(2).max(4),
    answerIndex: z.number().int().min(0),
    why,
  })
  .refine((p) => p.answerIndex < p.options.length, {
    message: "answerIndex must point at one of the options",
    path: ["answerIndex"],
  })
  .refine(whyAligned.check, whyAligned.params);

/** Say a Tagalog sentence aloud; graded on the speech-recognition transcript. */
const speak = z.object({
  text: text,
  translation: text,
});

/** Read a short conversation and choose the next line. */
const dialogue = z
  .object({
    lines: z
      .array(z.object({ speaker: z.enum(["A", "B"]), tl: text, en: text }))
      .min(1)
      .max(6),
    options: z.array(text).min(2).max(4),
    answerIndex: z.number().int().min(0),
    /** English meaning of the correct reply, shown in feedback. */
    replyEn: text,
    why,
  })
  .refine((p) => p.answerIndex < p.options.length, {
    message: "answerIndex must point at one of the options",
    path: ["answerIndex"],
  })
  .refine(whyAligned.check, whyAligned.params);

const affix = z.custom<Affix>((v) => typeof v === "string" && (AFFIXES as readonly string[]).includes(v), {
  message: "Unknown verb affix",
});
const verbForm = z.enum(VERB_FORMS);

/** Type the inflected form of `root` that completes a sentence containing exactly one `___`. */
const conjugate = z
  .object({
    sentence: text,
    translation: text,
    root: text,
    affix,
    form: verbForm,
    answers: z.array(text).min(1),
    mistakes,
  })
  .refine((p) => p.sentence.split("___").length === 2, {
    message: "sentence must contain exactly one ___ blank",
    path: ["sentence"],
  });

/** Given an inflected `word`, identify its root, by choosing among `options` or typing it. */
const findRoot = z
  .object({
    word: text,
    translation: text.optional(),
    mode: z.enum(["choice", "type"]),
    options: z.array(text).min(2).max(4).optional(),
    root: text,
    hint: text,
  })
  .refine((p) => (p.mode === "choice") === (p.options !== undefined), {
    message: "options are required for choice mode and not allowed for type mode",
    path: ["options"],
  })
  .refine((p) => !p.options || p.options.some((o) => fold(o) === fold(p.root)), {
    message: "options must include the root",
    path: ["options"],
  });

/** Rewrite `source` per `instruction` (e.g. change the aspect), by building or typing the result. */
const transform = z.object({
  source: text,
  sourceEn: text,
  instruction: text,
  mode: z.enum(["build", "type"]),
  /** Accepted token sequences. */
  answers: z.array(z.array(text).min(1)).min(1),
  distractors: z.array(text).default([]),
  mistakes,
});

/** Fill in the hidden cells of a verb's form table by tapping tiles. */
const paradigm = z
  .object({
    root: text,
    affix,
    en: text,
    cells: z.array(z.object({ form: verbForm, value: text, hidden: z.boolean() })).min(2),
    distractors: z.array(text),
  })
  .refine((p) => p.cells.some((c) => c.hidden), {
    message: "at least one cell must be hidden",
    path: ["cells"],
  });

export const payloadSchemas = {
  select_translation: selectTranslation,
  word_bank: wordBank,
  match_pairs: matchPairs,
  fill_blank: fillBlank,
  type_translation: typeTranslation,
  listen_select: listenSelect,
  speak,
  dialogue,
  conjugate,
  find_root: findRoot,
  transform,
  paradigm,
} as const;

export type PayloadFor<T extends ExerciseType> = z.infer<(typeof payloadSchemas)[T]>;

/** A validated exercise: discriminated union of `{ type, payload }`. */
export type ParsedExercise = {
  [T in ExerciseType]: { type: T; payload: PayloadFor<T> };
}[ExerciseType];

export class ExerciseValidationError extends Error {
  constructor(
    message: string,
    readonly issues: z.core.$ZodIssue[] = [],
  ) {
    super(message);
    this.name = "ExerciseValidationError";
  }
}

/** Validate an untrusted `{ type, payload }` pair, throwing a readable error on failure. */
export function parseExercise(type: ExerciseType, payload: unknown): ParsedExercise {
  if (!(EXERCISE_TYPES as readonly string[]).includes(type)) {
    throw new ExerciseValidationError(`Unknown exercise type "${String(type)}"`);
  }
  const result = payloadSchemas[type].safeParse(payload);
  if (!result.success) {
    const summary = result.error.issues.map((i) => `${i.path.join(".") || "payload"}: ${i.message}`).join("; ");
    throw new ExerciseValidationError(`Invalid ${type} exercise — ${summary}`, result.error.issues);
  }
  return { type, payload: result.data } as ParsedExercise;
}

/** Like `parseExercise` but returns null instead of throwing. */
export function safeParseExercise(type: ExerciseType, payload: unknown): ParsedExercise | null {
  try {
    return parseExercise(type, payload);
  } catch {
    return null;
  }
}

function duplicates(values: string[]): string[] {
  const seen = new Set<string>();
  const dupes = new Set<string>();
  for (const v of values.map(fold)) (seen.has(v) ? dupes : seen).add(v);
  return [...dupes];
}

/** Reviewer-facing quality warnings. An empty array means "looks clean". */
export function lintExercise(ex: ParsedExercise): string[] {
  const warnings: string[] = [];
  switch (ex.type) {
    case "select_translation":
    case "fill_blank":
    case "listen_select":
    case "dialogue": {
      const d = duplicates(ex.payload.options);
      if (d.length) warnings.push(`Duplicate options: ${d.join(", ")}`);
      if (ex.payload.options.length < 3) warnings.push("Only two options — easy to guess.");
      break;
    }
    case "word_bank": {
      const answer = new Set(ex.payload.answer.map(fold));
      const clash = ex.payload.distractors.filter((t) => answer.has(fold(t)));
      if (clash.length) warnings.push(`Distractor tiles also appear in the answer: ${clash.join(", ")}`);
      if (ex.payload.distractors.length === 0) warnings.push("No distractor tiles — the answer is just a reordering.");
      break;
    }
    case "match_pairs": {
      const d = [...duplicates(ex.payload.pairs.map((p) => p.tl)), ...duplicates(ex.payload.pairs.map((p) => p.en))];
      if (d.length) warnings.push(`Duplicate pair entries: ${d.join(", ")}`);
      break;
    }
    case "type_translation": {
      const d = duplicates(ex.payload.answers);
      if (d.length) warnings.push(`Duplicate accepted answers: ${d.join(", ")}`);
      break;
    }
    case "conjugate": {
      const answer = fold(ex.payload.answers[0]!);
      if (fold(ex.payload.sentence).includes(answer) || fold(ex.payload.translation).includes(answer))
        warnings.push("The answer appears in the sentence or translation.");
      break;
    }
    case "transform": {
      const source = fold(ex.payload.source);
      if (ex.payload.answers.some((a) => fold(a.join(" ")) === source))
        warnings.push("The source already equals an accepted answer.");
      break;
    }
    case "paradigm": {
      const tiles = [...ex.payload.cells.filter((c) => c.hidden).map((c) => c.value), ...ex.payload.distractors];
      const d = duplicates(tiles);
      if (d.length) warnings.push(`Duplicate tiles: ${d.join(", ")}`);
      break;
    }
    case "speak": {
      if (ex.payload.text.split(/\s+/).length > 8)
        warnings.push("Long sentence: speech recognition struggles past ~8 words.");
      break;
    }
  }
  return warnings;
}
