/**
 * Known-vocabulary check for grammar content: every Tagalog word in a pattern's examples, table
 * cells and drills must already be taught by the time the pattern's lesson is reached.
 *
 * "Known" means a lesson word (see `knownWordsUpTo`), a function word, a name (capitalised
 * mid-sentence) or an inflected form of an approved verb table. English text (explanations,
 * translations, instructions) and a pattern's "common mistakes" are not checked.
 */
import { knownWordsUpTo, type CourseDefinition } from "../content/course";
import { analyse, type VerbTableData } from "./analyse";

/**
 * Words every learner is assumed to have without a lesson: particles, pronouns and demonstratives.
 * Extend only by commit, with a comment saying why. `taga` is the origin prefix of "taga-Maynila".
 */
export const FUNCTION_WORDS: ReadonlySet<string> = new Set(
  (
    "ang ng sa si ni kay mga ay ko mo ka ba na pa po opo naman lang at may wala hindi huwag din rin daw raw nga " +
    "ito iyan iyon dito diyan doon ako ikaw siya kami tayo kayo sila akin iyo kanya amin atin inyo kanila " +
    "niya namin natin ninyo nila kita taga " +
    // Contraction fragments left after splitting at the apostrophe: ba't, sa'yo, 'yan, 'yon, 'di, 'wag.
    "t yo yan yon di wag"
  ).split(" "),
);

/** Trims anything that is not a letter or digit from both ends (this also removes the "___" blank). */
const trimEdges = (s: string) => s.replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, "");

const isCapitalised = (s: string) => /^\p{Lu}/u.test(s);

/** Closing quotes that may follow a sentence-final mark: `."` `.”` `.’` `.'`. */
const CLOSING_QUOTES = `"\u201D\u2019'`;
/** Quotes that open quoted speech. A bare apostrophe is not listed: it also starts contractions ('yan). */
const OPENING_QUOTE = /^["\u201C\u2018]/u;
/** A capitalised abbreviation or initial such as "Gng.", "Bb.", "G.", "Dr.", "A."; it does not end a sentence. */
const ABBREVIATION = /^\p{Lu}\p{L}{0,2}\.$/u;
const SENTENCE_END = new RegExp(`[.!?\u2026][${CLOSING_QUOTES}]*$`, "u");

/** True when the raw whitespace-delimited token closes a sentence (and is not an abbreviation). */
function endsSentence(raw: string): boolean {
  const bare = raw.replace(new RegExp(`[${CLOSING_QUOTES}]+$`, "u"), "");
  return SENTENCE_END.test(raw) && !ABBREVIATION.test(bare.replace(/^["\u201C\u2018(]+/u, ""));
}

/**
 * Words of `sentence` that are neither known, function words, names nor forms of an approved verb
 * table, lower-cased, in order of first appearance. Tokens are whitespace-separated and trimmed of
 * edge punctuation. A capitalised token is a name unless it is sentence-initial: the first token,
 * one after a sentence end (not after an abbreviation like "Gng."), after an opening quote or after
 * a colon. A word may carry the -ng / -g linker (isdang, ulang) and contractions split on
 * apostrophes (ba't, sa'yo). `taga-X` is checked as `taga` plus `X`; other hyphenated tokens
 * (mag-aral, nag-aaral) are checked whole.
 */
export function unknownWords(sentence: string, known: ReadonlySet<string>, tables: readonly VerbTableData[]): string[] {
  const isBase = (word: string) => known.has(word) || FUNCTION_WORDS.has(word) || analyse(word, tables).length > 0;
  // The linker -ng follows a vowel and -g follows n (ulan -> ulang); the base word must be known.
  const isKnown = (word: string) => {
    if (isBase(word)) return true;
    if (!word.endsWith("ng")) return false;
    // After a vowel the linker is -ng (isda -> isdang); after n it is -g (ulan -> ulang).
    const afterVowel = word.slice(0, -2);
    return (/[aeiou]$/u.test(afterVowel) && isBase(afterVowel)) || isBase(word.slice(0, -1));
  };
  const unknown: string[] = [];
  const report = (word: string) => {
    if (!unknown.includes(word)) unknown.push(word);
  };
  /** Checks one lower-cased word, splitting contractions at apostrophes. */
  const check = (word: string) => {
    for (const part of word.split(/['\u2019]/u).filter((p) => p !== "")) if (!isKnown(part)) report(part);
  };

  let initial = true;
  for (const raw of sentence.split(/\s+/)) {
    const startsSentence = initial || OPENING_QUOTE.test(raw);
    initial = endsSentence(raw) || /:$/.test(raw);
    const token = trimEdges(raw);
    // The blank, bare punctuation and numbers carry no vocabulary.
    if (!/\p{L}/u.test(token)) continue;
    if (!startsSentence && isCapitalised(token)) continue; // a name

    const taga = /^taga-(.+)$/iu.exec(token);
    if (taga) {
      // "taga-Maynila": the origin prefix and the place are separate words; a capitalised place is a name.
      if (!isCapitalised(taga[1])) check(taga[1].toLocaleLowerCase("en"));
      continue;
    }
    check(token.toLocaleLowerCase("en"));
  }
  return unknown;
}

/**
 * One message per unknown word in the course's grammar content, e.g.
 * `pattern um-aspect example 1: "Kumain ako ng isda." uses unknown "isda"`. Each pattern is
 * checked against the words known at its teaching lesson, so a lesson-1 pattern cannot lean on a
 * lesson-2 word.
 */
export function grammarVocabIssues(course: CourseDefinition, tables: readonly VerbTableData[]): string[] {
  const issues: string[] = [];
  const skills = course.units.flatMap((u) => u.skills);

  for (const pattern of course.grammar) {
    const skill = skills.find((s) => s.lessons.some((l) => l.teaches.includes(pattern.id)));
    const lessonIndex = skill?.lessons.findIndex((l) => l.teaches.includes(pattern.id)) ?? -1;
    if (!skill) {
      issues.push(`pattern ${pattern.id} is not taught by any lesson`);
      continue;
    }
    const known = knownWordsUpTo(course, skill.slug, lessonIndex);
    const check = (where: string, sentence: string) => {
      for (const word of unknownWords(sentence, known, tables))
        issues.push(`pattern ${pattern.id} ${where}: "${sentence}" uses unknown "${word}"`);
    };

    pattern.examples.forEach(([tl], i) => check(`example ${i + 1}`, tl));
    // Header cells are column labels, so only body cells are Tagalog content.
    pattern.table?.rows.forEach((row, r) => row.forEach((c, i) => check(`table row ${r + 1} cell ${i + 1}`, c)));
    pattern.drills.frames.forEach(([sentence], i) => check(`frame ${i + 1}`, sentence));
    pattern.drills.transforms.forEach(([source, , , answers], i) => {
      check(`transform ${i + 1} source`, source);
      answers.forEach((answer, a) => check(`transform ${i + 1} answer ${a + 1}`, answer));
    });
    pattern.drills.choices.forEach(([sentence, , options], i) => {
      check(`choice ${i + 1}`, sentence);
      options.forEach((option, o) => check(`choice ${i + 1} option ${o + 1}`, option));
    });
  }
  return issues;
}
