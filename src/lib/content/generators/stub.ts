/**
 * StubGenerator — an offline, deterministic exercise generator.
 *
 * It needs no network or API key, so the whole content pipeline (generate → review → approve)
 * works on a fresh machine. Quality comes from the hand-written word list: every exercise is
 * assembled from a word's gloss, accepted synonyms and example sentence, following a fixed
 * recipe that mixes all five exercise types.
 *
 * Ambiguity guards (the most common way auto-generated exercises go wrong):
 *  - Two words whose meanings overlap (kami / tayo both mean "we") are never used as each
 *    other's distractors or placed in the same match-pairs set.
 *  - Fill-in-the-blank distractors always have a different part of speech than the answer,
 *    so only one option is grammatical.
 *  - Typed English→Tagalog answers accept every Tagalog word in the skill with that meaning.
 */
import type { CourseWord, GenerationRequest } from "../course";
import { parseExercise, type ExerciseType, type ParsedExercise } from "../schema";
import type { ExerciseGenerator, GenerationResult } from "./types";

/** FNV-1a string hash → 32-bit seed. */
function hash(input: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < input.length; i++) {
    h ^= input.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

/** mulberry32: tiny, fast, seedable PRNG. */
function rng(seed: number): () => number {
  let a = seed;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function shuffle<T>(items: readonly T[], rand: () => number): T[] {
  const a = [...items];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

const lower = (s: string) => s.toLocaleLowerCase();

/** All English meanings of a word, lower-cased. */
const meanings = (w: CourseWord) => new Set([w.en, ...w.accept].map(lower));

/** True when the two words could be confused because their meanings overlap. */
function overlaps(a: CourseWord, b: CourseWord): boolean {
  if (lower(a.tl) === lower(b.tl)) return true;
  const ma = meanings(a);
  return [...meanings(b)].some((m) => ma.has(m));
}

/** Words with a plain English gloss (excludes e.g. "po" whose gloss is "(polite particle)"). */
const glossable = (w: CourseWord) => !w.en.startsWith("(");

/** Split a sentence into word-bank tiles, dropping surrounding punctuation. */
export function tiles(sentence: string): string[] {
  return sentence
    .split(/\s+/)
    .map((t) => t.replace(/^[^\p{L}\p{N}']+|[^\p{L}\p{N}']+$/gu, ""))
    .filter(Boolean);
}

function capitalizeLike(word: string, model: string): string {
  return model[0] && model[0] === model[0].toLocaleUpperCase() && model[0] !== model[0].toLocaleLowerCase()
    ? word[0].toLocaleUpperCase() + word.slice(1)
    : word;
}

type Draft = { type: ExerciseType; payload: unknown };

/**
 * Words that keep their capital letter as tiles: anything capitalised mid-sentence somewhere in
 * the skill (names, Lola, Nanay…), capitalised headwords (Lunes) and the English pronoun "I".
 */
function properNouns(words: CourseWord[]): Set<string> {
  const proper = new Set(["I", "I'm", "I'll", "I've", "I'd"]);
  for (const w of words) {
    if (/^\p{Lu}/u.test(w.tl)) proper.add(w.tl);
    for (const sentence of [w.ex[0], w.ex[1], ...w.exAccept]) {
      tiles(sentence)
        .slice(1)
        .forEach((t) => /^\p{Lu}/u.test(t) && proper.add(t));
    }
  }
  return proper;
}

class LessonBuilder {
  private readonly rand: () => number;
  private readonly proper: Set<string>;

  constructor(private readonly req: GenerationRequest) {
    this.rand = rng(hash(`${req.skill.slug}#${req.lesson.index}`));
    this.proper = properNouns(req.allWords);
  }

  /** Tiles for a sentence with the sentence-initial capital removed (unless it's a proper noun). */
  private tilesOf(sentence: string): string[] {
    const t = tiles(sentence);
    if (t[0] && !this.proper.has(t[0])) t[0] = t[0][0].toLocaleLowerCase() + t[0].slice(1);
    return t;
  }

  /** Distractor words: not confusable with `answer`, optionally filtered further. */
  private distractors(answer: CourseWord, count: number, extra: (w: CourseWord) => boolean = () => true) {
    const pool = this.req.allWords.filter((w) => !overlaps(w, answer) && extra(w));
    return shuffle(pool, this.rand).slice(0, count);
  }

  private choice(prompt: string, promptLang: "tl" | "en", answer: string, wrong: string[]): Draft | null {
    if (wrong.length < 2) return null;
    const options = shuffle([answer, ...wrong], this.rand);
    return { type: "select_translation", payload: { prompt, promptLang, options, answerIndex: options.indexOf(answer) } };
  }

  mcTlToEn(w: CourseWord): Draft | null {
    if (!glossable(w)) return null;
    const wrong = this.distractors(w, 3, glossable).map((d) => d.en);
    return this.choice(w.tl, "tl", w.en, wrong);
  }

  mcEnToTl(w: CourseWord): Draft | null {
    if (!glossable(w)) return null;
    const wrong = this.distractors(w, 3).map((d) => d.tl);
    return this.choice(w.en, "en", w.tl, wrong);
  }

  mcSentence(w: CourseWord): Draft | null {
    const others = this.req.allWords.filter((o) => o.tl !== w.tl && lower(o.ex[1]) !== lower(w.ex[1]));
    const wrong = shuffle(others, this.rand)
      .slice(0, 2)
      .map((o) => o.ex[1]);
    return this.choice(w.ex[0], "tl", w.ex[1], wrong);
  }

  matchPairs(focus: CourseWord[]): Draft | null {
    const chosen: CourseWord[] = [];
    const candidates = [...focus, ...shuffle(this.req.reviewWords, this.rand), ...shuffle(this.req.allWords, this.rand)];
    for (const w of candidates) {
      if (chosen.length === 4) break;
      if (glossable(w) && !chosen.some((c) => overlaps(c, w))) chosen.push(w);
    }
    if (chosen.length < 3) return null;
    return { type: "match_pairs", payload: { pairs: chosen.map((w) => ({ tl: w.tl, en: w.en })) } };
  }

  fillBlank(w: CourseWord): Draft | null {
    const [sentence, translation] = w.ex;
    // Whole-word, case-insensitive match of the headword inside its example sentence.
    const escaped = w.tl.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const match = new RegExp(`(^|[^\\p{L}])(${escaped})(?=$|[^\\p{L}])`, "iu").exec(sentence);
    if (!match) return null;
    const surface = match[2];
    const start = match.index + match[1].length;
    const blanked = sentence.slice(0, start) + "___" + sentence.slice(start + surface.length);
    const wrong = this.distractors(w, 2, (d) => d.pos !== w.pos && !d.tl.includes(" ")).map((d) =>
      capitalizeLike(d.tl, surface),
    );
    if (wrong.length < 2) return null;
    const options = shuffle([surface, ...wrong], this.rand);
    return {
      type: "fill_blank",
      payload: { sentence: blanked, translation, options, answerIndex: options.indexOf(surface) },
    };
  }

  /** Extra tiles drawn from other example sentences that don't collide with any accepted answer. */
  private extraTiles(side: 0 | 1, exclude: string[][], count: number): string[] {
    const banned = new Set(exclude.flat().map(lower));
    const seen = new Set<string>();
    const pool: string[] = [];
    for (const o of shuffle(this.req.allWords, this.rand)) {
      for (const t of this.tilesOf(o.ex[side])) {
        if (!banned.has(lower(t)) && !seen.has(lower(t))) {
          seen.add(lower(t));
          pool.push(t);
        }
      }
    }
    return pool.slice(0, count);
  }

  wordBankToTl(w: CourseWord): Draft | null {
    const answer = this.tilesOf(w.ex[0]);
    if (answer.length < 2) return null;
    return {
      type: "word_bank",
      payload: { prompt: w.ex[1], promptLang: "en", answer, distractors: this.extraTiles(0, [answer], 3) },
    };
  }

  wordBankToEn(w: CourseWord): Draft | null {
    const answer = this.tilesOf(w.ex[1]);
    if (answer.length < 2) return null;
    const alternates = w.exAccept.map((e) => this.tilesOf(e)).filter((t) => t.length > 0);
    return {
      type: "word_bank",
      payload: {
        prompt: w.ex[0],
        promptLang: "tl",
        answer,
        ...(alternates.length ? { alternates } : {}),
        distractors: this.extraTiles(1, [answer, ...alternates], 3),
      },
    };
  }

  typeToEn(w: CourseWord): Draft | null {
    if (!glossable(w)) return null;
    return { type: "type_translation", payload: { prompt: w.tl, promptLang: "tl", answers: [w.en, ...w.accept] } };
  }

  typeToTl(w: CourseWord): Draft | null {
    if (!glossable(w)) return null;
    const synonyms = this.req.allWords.filter((o) => o.tl !== w.tl && meanings(o).has(lower(w.en))).map((o) => o.tl);
    return { type: "type_translation", payload: { prompt: w.en, promptLang: "en", answers: [w.tl, ...synonyms] } };
  }
}

type Slot = { make: (b: LessonBuilder, w: CourseWord) => Draft | null; word: number };

/** The lesson recipe: which template to use for which of the lesson's new words. */
const RECIPE: Slot[] = [
  { make: (b, w) => b.mcTlToEn(w), word: 0 },
  { make: (b, w) => b.mcEnToTl(w), word: 1 },
  { make: (b, w) => b.fillBlank(w), word: 2 },
  { make: (b, w) => b.wordBankToTl(w), word: 3 },
  { make: (b, w) => b.typeToEn(w), word: 4 },
  { make: (b, w) => b.wordBankToEn(w), word: 0 },
  { make: (b, w) => b.mcSentence(w), word: 1 },
  { make: (b, w) => b.fillBlank(w), word: 5 },
  { make: (b, w) => b.typeToTl(w), word: 2 },
  { make: (b, w) => b.wordBankToTl(w), word: 4 },
];

export class StubGenerator implements ExerciseGenerator {
  readonly provider = "stub" as const;
  readonly model = "stub-templates-v1";

  async generate(req: GenerationRequest): Promise<GenerationResult> {
    const b = new LessonBuilder(req);
    const drafts: Draft[] = [];
    const words = req.words;

    RECIPE.forEach((slot, i) => {
      // Try the slot's word first, then the following words, until the template applies.
      for (let k = 0; k < words.length; k++) {
        const d = slot.make(b, words[(slot.word + k) % words.length]);
        if (d) {
          drafts.push(d);
          break;
        }
      }
      // Drop a match-pairs round in after the first three exercises.
      if (i === 2) {
        const mp = b.matchPairs(words);
        if (mp) drafts.push(mp);
      }
    });

    const exercises: ParsedExercise[] = [];
    const rejected: GenerationResult["rejected"] = [];
    for (const d of drafts) {
      try {
        exercises.push(parseExercise(d.type, d.payload));
      } catch (e) {
        rejected.push({ raw: d, reason: e instanceof Error ? e.message : String(e) });
      }
    }
    return { exercises, rejected };
  }
}
