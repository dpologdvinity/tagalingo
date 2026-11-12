/**
 * Tests for the known-vocabulary check: `unknownWords` on single sentences and `grammarVocabIssues`
 * over a small course fixture where lesson 2 introduces the words lesson 1 may not use yet.
 */
import { describe, expect, it } from "vitest";
import { parseCourse } from "../content/course";
import { analyse, type VerbTableData } from "./analyse";
import { conjugate } from "./morphology";
import { FUNCTION_WORDS, grammarVocabIssues, unknownWords } from "./vocab-check";

const kainTable: VerbTableData = {
  root: "kain",
  affix: "um",
  en: "eat",
  forms: conjugate({ root: "kain", en: "eat", affixes: ["um"], glottal: false, stem: null, forms: {} }, "um"),
};
const tables = [kainTable];
const known = new Set(["isda"]);

describe("unknownWords", () => {
  it("accepts inflected forms of approved verbs, known words and function words", () => {
    expect(unknownWords("Kumain ako ng isda.", known, tables)).toEqual([]);
  });

  it("reports unknown words lower-cased, in order, without duplicates", () => {
    expect(unknownWords("Uminom ako ng gatas.", known, tables)).toEqual(["uminom", "gatas"]);
    expect(unknownWords("Gatas ng gatas.", known, tables)).toEqual(["gatas"]);
  });

  it("treats capitalised words after the first as names, but checks the first word", () => {
    expect(unknownWords("Kumain si Ana.", known, tables)).toEqual([]);
    expect(unknownWords("Ana ay kumain.", known, tables)).toEqual(["ana"]);
    // A new sentence restarts "first word".
    expect(unknownWords("Kumain ako. Ana ay kumain.", known, tables)).toEqual(["ana"]);
  });

  it("splits taga-X and checks both halves", () => {
    expect(unknownWords("Taga-Maynila ako.", known, tables)).toEqual([]);
    expect(unknownWords("Taga-isda ako.", known, tables)).toEqual([]);
    expect(unknownWords("Taga-gatas ako.", known, tables)).toEqual(["gatas"]);
  });

  it("checks other hyphenated words whole, against verb tables first and then known words", () => {
    const magAral: VerbTableData = {
      root: "aral",
      affix: "mag",
      en: "study",
      forms: conjugate({ root: "aral", en: "study", affixes: ["mag"], glottal: false, stem: null, forms: {} }, "mag"),
    };
    expect(analyse("nag-aaral", [magAral]).length).toBeGreaterThan(0);
    expect(unknownWords("Nag-aaral ako.", known, [magAral])).toEqual([]);
    expect(unknownWords("Nag-aaral ako.", known, [])).toEqual(["nag-aaral"]);
    expect(unknownWords("Mag-aral ako.", new Set(["mag-aral"]), [])).toEqual([]);
  });

  it("ignores the blank, numbers and punctuation", () => {
    expect(unknownWords("___ ako ng isda, 2 beses?", known, tables)).toEqual(["beses"]);
    expect(unknownWords("... ___!", known, tables)).toEqual([]);
  });

  it("does not restart a sentence after an abbreviation", () => {
    expect(unknownWords("Si Gng. Reyes ay kumain.", known, tables)).toEqual([]);
    expect(unknownWords("Si Bb. Cruz at si G. Reyes ay kumain.", known, tables)).toEqual([]);
    expect(unknownWords("Si A. Reyes ay kumain.", known, tables)).toEqual([]);
    // A real sentence end that is a short lower-case word still restarts the sentence.
    expect(unknownWords("Kumain ka na. Reyes ay kumain.", known, tables)).toEqual(["reyes"]);
  });

  it("treats the word after an opening quote or a colon as sentence-initial, and closing quotes end a sentence", () => {
    const withSabi = new Set(["isda", "sabi"]);
    expect(unknownWords('Sabi niya: "Kumusta po."', withSabi, tables)).toEqual(["kumusta"]);
    expect(unknownWords("Sabi niya: Kumusta po.", withSabi, tables)).toEqual(["kumusta"]);
    expect(unknownWords("Kumain ako ng isda: Ana ay kumain.", withSabi, tables)).toEqual(["ana"]);
    expect(unknownWords('Sabi ni Ana, "Kumain ako."', withSabi, tables)).toEqual([]);
    expect(unknownWords('"Kumain ako." Ana ay kumain.', withSabi, tables)).toEqual(["ana"]);
    expect(unknownWords("\u201CKumain ako.\u201D Ana ay kumain.", withSabi, tables)).toEqual(["ana"]);
  });

  it("accepts linker -ng/-g forms of a known word", () => {
    expect(unknownWords("isdang kumain", known, tables)).toEqual([]);
    expect(unknownWords("magandang isda", new Set(["maganda", "isda"]), tables)).toEqual([]);
    expect(unknownWords("ulang", new Set(["ulan"]), tables)).toEqual([]);
    // The base must be known, and must end in a vowel (-ng) or n (-g).
    expect(unknownWords("pusang", known, tables)).toEqual(["pusang"]);
    expect(unknownWords("isdag", known, tables)).toEqual(["isdag"]);
    // Linker forms of approved verb forms count too.
    expect(unknownWords("kumaing", known, tables)).toEqual([]);
  });

  it("splits contractions on apostrophes", () => {
    expect(unknownWords("Kumain ba't isda?", known, tables)).toEqual([]);
    expect(unknownWords("Kumain sa'yo ang isda.", known, tables)).toEqual([]);
    expect(unknownWords("'Yan ay isda. 'Yon ay 'di isda. 'Wag kumain.", known, tables)).toEqual([]);
    expect(unknownWords("Kumain ba'ng gatas?", known, tables)).toEqual(["gatas"]);
  });

  it("exposes the function-word list", () => {
    for (const w of ["ang", "ng", "sa", "ako", "kita", "taga"]) expect(FUNCTION_WORDS.has(w)).toBe(true);
  });
});

describe("grammarVocabIssues", () => {
  /** Skill s1: lesson 1 teaches pattern a (word "isda"), lesson 2 adds "gatas" and teaches pattern b. */
  const fixture = (overrides: { a?: Record<string, unknown>; b?: Record<string, unknown> } = {}) => {
    const word = (tl: string, en: string) => ({ tl, en, pos: "noun", ex: [`${tl}.`, `${en}.`] });
    const pattern = (id: string, extra: Record<string, unknown>) => ({
      id,
      title: id,
      rule: "r",
      examples: [
        ["Kumain ako ng isda.", "I ate fish."],
        ["Kumain ka ng isda.", "You ate fish."],
      ],
      ...extra,
    });
    return parseCourse({
      course: { slug: "tl-en", title: "T", fromLang: "en", toLang: "tl" },
      units: [
        {
          slug: "u1",
          title: "U1",
          subtitle: "s",
          color: "#13A3A9",
          skills: [
            {
              slug: "s1",
              title: "S1",
              emoji: "x",
              description: "d",
              lessons: [
                { title: "L1", words: ["isda"], teaches: ["um-aspect"] },
                { title: "L2", words: ["gatas"], teaches: ["um-more"] },
              ],
              words: [word("isda", "fish"), word("gatas", "milk"), word("tinapay", "bread"), word("bigas", "rice")],
            },
          ],
        },
      ],
      grammar: [pattern("um-aspect", overrides.a ?? {}), pattern("um-more", overrides.b ?? {})],
    });
  };

  it("reports nothing when every word is known by the teaching lesson", () => {
    expect(grammarVocabIssues(fixture(), tables)).toEqual([]);
  });

  it("reports a lesson-1 example that uses a lesson-2 word", () => {
    const course = fixture({
      a: {
        examples: [
          ["Kumain ako ng isda.", "I ate fish."],
          ["Kumain ako ng gatas.", "I ate milk."],
        ],
      },
    });
    expect(grammarVocabIssues(course, tables)).toEqual([
      'pattern um-aspect example 2: "Kumain ako ng gatas." uses unknown "gatas"',
    ]);
    // The same sentence is fine in the pattern taught by lesson 2.
    expect(grammarVocabIssues(fixture({ b: { examples: course.grammar[0].examples } }), tables)).toEqual([]);
  });

  it("does not count a skill word that is in no lesson as known", () => {
    const course = fixture({
      b: {
        examples: [
          ["Kumain ako ng tinapay.", "I ate bread."],
          ["Kumain ako ng gatas.", "I ate milk."],
        ],
      },
    });
    expect(grammarVocabIssues(course, tables)).toEqual([
      'pattern um-more example 1: "Kumain ako ng tinapay." uses unknown "tinapay"',
    ]);
  });

  it("checks table cells, frames, transforms and choices", () => {
    const course = fixture({
      a: {
        table: { head: ["Example"], rows: [["Kumain ako ng isda."], ["Kumain ako ng bigas."]] },
        drills: {
          frames: [["___ ako ng tinapay.", "I ate bread.", "um", "completed"]],
          transforms: [["Kumain ako ng isda.", "I ate fish.", "Make it a question", ["Kumain ba ako ng mangga?"]]],
          choices: [["Kumain ___ ng isda.", "x ate fish.", ["ako", "pakwan"], 0, [null, "Wrong."]]],
        },
      },
    });
    expect(grammarVocabIssues(course, tables)).toEqual([
      'pattern um-aspect table row 2 cell 1: "Kumain ako ng bigas." uses unknown "bigas"',
      'pattern um-aspect frame 1: "___ ako ng tinapay." uses unknown "tinapay"',
      'pattern um-aspect transform 1 answer 1: "Kumain ba ako ng mangga?" uses unknown "mangga"',
      'pattern um-aspect choice 1 option 2: "pakwan" uses unknown "pakwan"',
    ]);
  });
});
