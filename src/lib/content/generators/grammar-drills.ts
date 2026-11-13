/**
 * Grammar drills for the stub generator: turns the drill ingredients of the patterns a lesson
 * teaches or uses (frames, transforms, choices) plus the course's approved verb tables into
 * exercises, each tagged with the pattern it practises.
 *
 *  - Every inflected form comes from an approved verb table; a drill that needs a verb with no
 *    approved table is skipped (nothing is built, so nothing is rejected).
 *  - Only verbs the lesson has been taught are used (`req.grammar.verbs`), and only their tables
 *    count as known vocabulary, so a later skill's approved verb never leaks into an earlier lesson.
 *  - A drill whose only unknown words are forms of a taught verb that has no approved table yet is
 *    skipped like the verb drills are: nothing malformed was built, it just has to wait for review.
 *  - `checkDrill` is the automatic review every drill passes before a human sees it. A drill that
 *    fails is returned in `rejected` with the reason and never blocks the vocabulary drills.
 *  - A lesson gets at most `MAX_GRAMMAR_DRILLS` drills, shared round-robin between its patterns.
 */
import { analyse, type VerbTableData } from "@/lib/grammar/analyse";
import { conjugate } from "@/lib/grammar/morphology";
import { AFFIXES, VERB_FORMS, type Affix, type VerbForm } from "@/lib/grammar/types";
import { FUNCTION_WORDS, unknownWords } from "@/lib/grammar/vocab-check";
import { normalizeAnswer } from "@/lib/normalize";
import { shuffle } from "@/lib/random";
import type { GenerationRequest } from "../course";
import type { CoursePattern } from "../grammar-schema";
import { parseExercise, type ExerciseType } from "../schema";
import type { GenerationResult, TaggedExercise } from "./types";

/** Cap on grammar drills added to one lesson, so grammar never crowds out the vocabulary practice. */
export const MAX_GRAMMAR_DRILLS = 5;

/** Pattern ids that get a find-the-root question (they have no frames to hang one on). */
const ROOT_PATTERNS = new Set(["roots", "find-the-root"]);

/** Easier recognition drills first, typed production last. */
const RANK: Record<ExerciseType, number> = {
  fill_blank: 0,
  find_root: 1,
  paradigm: 2,
  transform: 3,
  conjugate: 4,
  select_translation: 5,
  word_bank: 5,
  match_pairs: 5,
  type_translation: 5,
  listen_select: 5,
  speak: 5,
  dialogue: 5,
};

type RawDrill = { type: ExerciseType; payload: unknown; patterns: string[] };
type Rejected = GenerationResult["rejected"][number];

const cellOf = (table: VerbTableData, form: VerbForm): string[] => table.forms[form] ?? [];
const findTable = (tables: readonly VerbTableData[], root: string, affix: Affix) =>
  tables.find((t) => t.root === root && t.affix === affix);

/** Whitespace-split tiles with surrounding punctuation dropped, as the word-bank tiles are. */
const tokenise = (sentence: string): string[] =>
  sentence
    .split(/\s+/)
    .map((t) => t.replace(/^[^\p{L}\p{N}']+|[^\p{L}\p{N}']+$/gu, ""))
    .filter(Boolean);

/**
 * Tiles of an answer sentence. The sentence-initial capital is dropped when the word is an ordinary
 * known word (so it does not tell the learner which tile comes first); names keep theirs.
 */
function answerTiles(sentence: string, req: GenerationRequest, taught: readonly VerbTableData[]): string[] {
  const [first, ...rest] = tokenise(sentence);
  if (first === undefined) return [];
  const lower = first.toLocaleLowerCase("en");
  const ordinary =
    req.grammar.knownWords.includes(lower) || FUNCTION_WORDS.has(lower) || analyse(lower, taught).length > 0;
  return [ordinary ? lower : first, ...rest];
}

/** Approved tables of the verbs this lesson has been taught (any affix the course lists for them). */
function taughtTables(req: GenerationRequest, tables: readonly VerbTableData[]): VerbTableData[] {
  return tables.filter((t) => req.grammar.verbs.some((v) => v.root === t.root && v.affixes.includes(t.affix)));
}

/**
 * Taught tables with `affix`, those whose root or forms are lesson words first (a stable sort, so
 * course order otherwise decides).
 */
function tablesWithAffix(req: GenerationRequest, taught: readonly VerbTableData[], affix: Affix): VerbTableData[] {
  const lessonWords = new Set(req.words.map((w) => normalizeAnswer(w.tl)));
  const inLesson = (t: VerbTableData) =>
    lessonWords.has(normalizeAnswer(t.root)) ||
    VERB_FORMS.some((f) => cellOf(t, f).some((c) => lessonWords.has(normalizeAnswer(c))));
  return taught.filter((t) => t.affix === affix).sort((a, b) => Number(inLesson(b)) - Number(inLesson(a)));
}

/**
 * The affixes a pattern is about: those of its frames, or else the one named by the id prefix
 * (`um-aspect` -> um). A pattern with neither is not a verb pattern and gets no paradigm.
 */
function patternAffixes(p: CoursePattern): Affix[] {
  const fromFrames = [...new Set(p.drills.frames.map(([, , affix]) => affix))];
  if (fromFrames.length) return fromFrames;
  const prefixed = AFFIXES.find((a) => p.id === a || p.id.startsWith(`${a}-`));
  return prefixed ? [prefixed] : [];
}

/** The authored multiple-choice question, with options shuffled and `why` kept aligned to them. */
function fillBlankDrill(p: CoursePattern, rand: () => number): RawDrill | null {
  const choice = p.drills.choices[0];
  if (!choice) return null;
  const [sentence, translation, options, answerIndex, why] = choice;
  const order = shuffle(
    options.map((_, i) => i),
    rand,
  );
  return {
    type: "fill_blank",
    payload: {
      sentence,
      translation,
      options: order.map((i) => options[i]),
      answerIndex: order.indexOf(answerIndex),
      why: order.map((i) => why[i]),
    },
    patterns: [p.id],
  };
}

/** One conjugation drill per frame whose verb has an approved table with the asked-for form. */
function conjugateDrills(p: CoursePattern, req: GenerationRequest, taught: readonly VerbTableData[]): RawDrill[] {
  const drills: RawDrill[] = [];
  for (const [sentence, translation, affix, form, root] of p.drills.frames) {
    const table = root ? findTable(taught, root, affix) : tablesWithAffix(req, taught, affix)[0];
    const answers = table && cellOf(table, form);
    if (!table || !answers?.length) continue;
    drills.push({
      type: "conjugate",
      payload: { sentence, translation, root: table.root, affix, form, answers },
      patterns: [p.id],
    });
  }
  return drills;
}

/**
 * Rewrite drill in build mode. Distractor tiles are the other forms of the verb in the first answer,
 * so the learner has to choose the right aspect, not just reorder words. The verb is found by
 * analysing the answer's words against the approved tables.
 */
function transformDrill(p: CoursePattern, req: GenerationRequest, taught: readonly VerbTableData[]): RawDrill | null {
  const transform = p.drills.transforms[0];
  if (!transform) return null;
  const [source, sourceEn, instruction, accepted] = transform;
  const answers = accepted.map((a) => answerTiles(a, req, taught));
  const reading = answers[0].flatMap((token) => analyse(token, taught))[0];
  const verb = reading && findTable(taught, reading.root, reading.affix);
  const inAnswer = new Set(answers.flat().map(normalizeAnswer));
  const distractors: string[] = [];
  for (const form of verb ? VERB_FORMS : []) {
    const tile = cellOf(verb!, form)[0];
    if (tile && !inAnswer.has(normalizeAnswer(tile)) && !distractors.includes(tile)) distractors.push(tile);
  }
  return {
    type: "transform",
    payload: { source, sourceEn, instruction, mode: "build", answers, distractors: distractors.slice(0, 3) },
    patterns: [p.id],
  };
}

/** Name the root of an inflected form, choosing among the roots of the lesson's other verbs. */
function findRootDrill(p: CoursePattern, req: GenerationRequest, taught: readonly VerbTableData[], rand: () => number) {
  if (!ROOT_PATTERNS.has(p.id)) return null;
  const affixes = patternAffixes(p);
  const table = (affixes.length ? affixes.flatMap((a) => tablesWithAffix(req, taught, a)) : taught)[0];
  const word = table && (cellOf(table, "incompleted")[0] ?? cellOf(table, "completed")[0]);
  if (!table || !word) return null;
  const others = [...new Set(taught.map((t) => t.root).filter((r) => r !== table.root))];
  const options = shuffle([table.root, ...shuffle(others, rand).slice(0, 2)], rand);
  const choice = options.length >= 2;
  return {
    type: "find_root",
    payload: {
      word,
      mode: choice ? "choice" : "type",
      ...(choice ? { options } : {}),
      root: table.root,
      hint: "Take off the affix and any repeated first syllable; the plain verb is what is left.",
    },
    patterns: [p.id],
  } satisfies RawDrill;
}

/** Fill-the-table drill for a verb pattern: two hidden cells with distinct spellings. */
function paradigmDrill(p: CoursePattern, req: GenerationRequest, taught: readonly VerbTableData[], rand: () => number) {
  const affix = patternAffixes(p)[0];
  const table = affix && tablesWithAffix(req, taught, affix)[0];
  if (!table) return null;
  const cells = VERB_FORMS.flatMap((form) =>
    cellOf(table, form).length ? [{ form, value: cellOf(table, form)[0] }] : [],
  );
  // A hidden tile must name exactly one cell: kumain is both the infinitive and the completed form.
  const spellings = cells.map((c) => normalizeAnswer(c.value));
  const unique = (c: (typeof cells)[number]) => spellings.filter((s) => s === normalizeAnswer(c.value)).length === 1;
  const hidden = new Set(
    shuffle(cells.filter(unique), rand)
      .slice(0, 2)
      .map((c) => c.form),
  );
  if (hidden.size < 2) return null;
  const spelled = new Set(spellings);
  const distractors = shuffle(
    taught.filter((t) => t !== table).flatMap((t) => VERB_FORMS.flatMap((f) => cellOf(t, f).slice(0, 1))),
    rand,
  ).filter((v, i, all) => !spelled.has(normalizeAnswer(v)) && all.indexOf(v) === i);
  return {
    type: "paradigm",
    payload: {
      root: table.root,
      affix,
      en: table.en,
      cells: cells.map((c) => ({ ...c, hidden: hidden.has(c.form) })),
      distractors: distractors.slice(0, 2),
    },
    patterns: [p.id],
  } satisfies RawDrill;
}

/**
 * Spellings the engine would draft for taught verbs that have no approved table. A drill that is
 * unknown-word-clean except for these is waiting on table review, not malformed.
 */
function uncoveredForms(req: GenerationRequest, taught: readonly VerbTableData[]): Set<string> {
  const forms = new Set<string>();
  for (const verb of req.grammar.verbs) {
    for (const affix of verb.affixes) {
      if (findTable(taught, verb.root, affix)) continue;
      let draft;
      try {
        draft = conjugate(verb, affix);
      } catch {
        continue; // the engine cannot conjugate this root; it has no forms to wait for
      }
      for (const form of VERB_FORMS) for (const cell of draft[form] ?? []) forms.add(normalizeAnswer(cell));
    }
  }
  return forms;
}

type Vetted = { drill: TaggedExercise } | { rejected: Rejected } | { skipped: true };

/**
 * Validate a raw drill and run the automatic checks; failures are reported, not thrown. A drill that
 * only fails because it needs forms no approved table covers yet is skipped instead.
 */
function vet(raw: RawDrill, req: GenerationRequest, tables: readonly VerbTableData[], uncovered: Set<string>): Vetted {
  try {
    const drill: TaggedExercise = { ...parseExercise(raw.type, raw.payload), patterns: raw.patterns };
    const known = new Set(req.grammar.knownWords);
    const unknown = tagalogTexts(drill).flatMap((text) => unknownWords(text, known, tables));
    if (unknown.length > 0 && unknown.every((w) => uncovered.has(normalizeAnswer(w)))) return { skipped: true };
    const reason = checkDrill(drill, req, tables);
    return reason === null ? { drill } : { rejected: { raw, reason } };
  } catch (e) {
    return { rejected: { raw, reason: e instanceof Error ? e.message : String(e) } };
  }
}

/**
 * Builds the lesson's grammar drills. A taught pattern offers (in this order) its multiple-choice,
 * one conjugation per frame, its transform, a find-the-root and a paradigm; a pattern the lesson
 * only `uses` offers one drill (conjugation, else multiple-choice, else transform). Drills that
 * pass `checkDrill` are dealt round-robin across the patterns up to the cap, then ordered from
 * recognition to production.
 */
export function buildGrammarDrills(
  req: GenerationRequest,
  tables: readonly VerbTableData[],
  rand: () => number,
): { drills: TaggedExercise[]; rejected: Rejected[] } {
  const taught = taughtTables(req, tables);
  const rejected: Rejected[] = [];
  const offers: RawDrill[][] = [];
  for (const p of req.grammar.teaches) {
    offers.push(
      [
        fillBlankDrill(p, rand),
        ...conjugateDrills(p, req, taught),
        transformDrill(p, req, taught),
        findRootDrill(p, req, taught, rand),
        paradigmDrill(p, req, taught, rand),
      ].filter((d) => d !== null),
    );
  }
  for (const p of req.grammar.uses) {
    const options = [
      conjugateDrills(p, req, taught)[0] ?? null,
      fillBlankDrill(p, rand),
      transformDrill(p, req, taught),
    ];
    offers.push(options.filter((d) => d !== null).slice(0, 1));
  }

  const uncovered = uncoveredForms(req, taught);
  const accepted = offers.map((offer) =>
    offer.flatMap((raw) => {
      const result = vet(raw, req, taught, uncovered);
      if ("rejected" in result) rejected.push(result.rejected);
      return "drill" in result ? [result.drill] : [];
    }),
  );
  const drills: TaggedExercise[] = [];
  for (let round = 0; drills.length < MAX_GRAMMAR_DRILLS && accepted.some((a) => a.length > round); round++)
    for (const a of accepted) if (a[round] && drills.length < MAX_GRAMMAR_DRILLS) drills.push(a[round]);
  return { drills: drills.sort((a, b) => RANK[a.type] - RANK[b.type]), rejected };
}

/** Texts of a drill that a learner reads as Tagalog, for the known-vocabulary check. */
function tagalogTexts(d: TaggedExercise): string[] {
  switch (d.type) {
    case "fill_blank":
      return [d.payload.sentence, ...d.payload.options];
    case "conjugate":
      return [d.payload.sentence, ...d.payload.answers];
    case "transform":
      return [d.payload.source, ...d.payload.answers.map((a) => a.join(" ")), ...d.payload.distractors];
    case "find_root":
      return [d.payload.word];
    default:
      // Paradigm tiles are table cells, which `checkDrill` compares with the approved tables directly.
      return [];
  }
}

/**
 * The automatic review of a grammar drill; returns why it must not be shown, or null when it passes:
 *  - its tags must be patterns this lesson teaches or uses;
 *  - every inflected form in it must be a cell of an approved verb table;
 *  - every Tagalog word in it must be known by this lesson (`unknownWords`);
 *  - a hint or instruction must not contain the answer.
 */
export function checkDrill(d: TaggedExercise, req: GenerationRequest, tables: readonly VerbTableData[]): string | null {
  if (d.patterns.length === 0) return "a grammar drill needs a pattern tag";
  const allowed = new Set([...req.grammar.teaches, ...req.grammar.uses].map((p) => p.id));
  const stray = d.patterns.find((id) => !allowed.has(id));
  if (stray) return `tagged "${stray}", which this lesson neither teaches nor uses`;

  switch (d.type) {
    case "conjugate": {
      const { root, affix, form, answers } = d.payload;
      const table = findTable(tables, root, affix);
      if (!table) return `${root}/${affix} has no approved verb table`;
      const cell = cellOf(table, form);
      const wrong = answers.find((a) => !cell.includes(a));
      if (wrong !== undefined)
        return `answer "${wrong}" is not in the ${form} cell of the approved verb table ${root}/${affix}`;
      break;
    }
    case "find_root": {
      const { word, root } = d.payload;
      if (!analyse(word, tables).some((a) => a.root === root))
        return `"${word}" is not a form of "${root}" in any approved verb table`;
      break;
    }
    case "paradigm": {
      const { root, affix, cells } = d.payload;
      const table = findTable(tables, root, affix);
      if (!table) return `${root}/${affix} has no approved verb table`;
      const wrong = cells.find((c) => cellOf(table, c.form)[0] !== c.value);
      if (wrong) return `cell ${wrong.form} "${wrong.value}" differs from the approved verb table ${root}/${affix}`;
      break;
    }
  }

  const known = new Set(req.grammar.knownWords);
  for (const text of tagalogTexts(d)) {
    const [unknown] = unknownWords(text, known, tables);
    if (unknown !== undefined) return `uses unknown word "${unknown}": "${text}"`;
  }

  return leaksAnswer(d, tables);
}

/**
 * Reason when a find_root hint or a transform instruction gives the answer away, else null. The
 * give-aways are the root, a whole accepted answer, or any answer word that is a form in an
 * approved table; all compared as whole words after `normalizeAnswer`.
 */
function leaksAnswer(d: TaggedExercise, tables: readonly VerbTableData[]): string | null {
  const mentions = (text: string, phrase: string) =>
    ` ${normalizeAnswer(text)} `.includes(` ${normalizeAnswer(phrase)} `);
  if (d.type === "find_root" && mentions(d.payload.hint, d.payload.root)) return "the hint gives the root away";
  if (d.type === "transform") {
    const { instruction, answers } = d.payload;
    const forms = answers.flat().filter((token) => analyse(token, tables).length > 0);
    if ([...answers.map((a) => a.join(" ")), ...forms].some((answer) => mentions(instruction, answer)))
      return "the instruction gives the answer away";
  }
  return null;
}
