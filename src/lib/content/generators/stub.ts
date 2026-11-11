/**
 * StubGenerator — an offline, deterministic exercise generator.
 *
 * It needs no network or API key, so the whole content pipeline (generate → review → approve)
 * works on a fresh machine. Quality comes from the hand-written word list: every exercise is
 * assembled from a word's gloss, accepted synonyms and example sentence, following a fixed
 * recipe that mixes every exercise type.
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
import { hash, rng, shuffle } from "@/lib/random";

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
  /** Headwords whose example sentence already appears somewhere in this lesson. */
  private readonly usedSentences = new Set<string>();
  /** Distractor tiles already shown in this lesson (lower-cased). */
  private readonly usedTiles = new Set<string>();
  /** Words already used as the target of a recognition exercise (pick / listen). */
  private readonly targets = new Set<string>();

  /** Reserve `w` as a recognition target; false if this lesson already quizzed it that way. */
  private claimTarget(w: CourseWord): boolean {
    if (this.targets.has(w.tl)) return false;
    this.targets.add(w.tl);
    return true;
  }

  constructor(private readonly req: GenerationRequest) {
    this.rand = rng(hash(`${req.skill.slug}#${req.lesson.index}`));
    this.proper = properNouns(req.allWords);
    // Dialogue lines (including the hand-picked wrong replies) sometimes reuse a word's example
    // sentence on purpose; reserve those so no other exercise in the lesson repeats them.
    const dialogueText = new Set(
      req.dialogues.flatMap((d) => [...d.lines.flatMap((l) => [l[1], l[2]]), ...d.wrong]).map(lower),
    );
    for (const w of req.allWords)
      if (dialogueText.has(lower(w.ex[0])) || dialogueText.has(lower(w.ex[1]))) this.usedSentences.add(w.tl);
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
    return {
      type: "select_translation",
      payload: { prompt, promptLang, options, answerIndex: options.indexOf(answer) },
    };
  }

  mcTlToEn(w: CourseWord): Draft | null {
    if (!glossable(w) || this.targets.has(w.tl)) return null;
    const wrong = this.distractors(w, 3, glossable).map((d) => d.en);
    const draft = this.choice(w.tl, "tl", w.en, wrong);
    if (draft) this.claimTarget(w);
    return draft;
  }

  mcEnToTl(w: CourseWord): Draft | null {
    if (!glossable(w) || this.targets.has(w.tl)) return null;
    const wrong = this.distractors(w, 3).map((d) => d.tl);
    const draft = this.choice(w.en, "en", w.tl, wrong);
    if (draft) this.claimTarget(w);
    return draft;
  }

  /** Reserve `w`'s example sentence for one exercise; false if the lesson already used it. */
  private claimSentence(w: CourseWord): boolean {
    if (this.usedSentences.has(w.tl)) return false;
    this.usedSentences.add(w.tl);
    return true;
  }

  mcSentence(w: CourseWord): Draft | null {
    if (this.usedSentences.has(w.tl)) return null;
    const inLesson = new Set([...this.req.words, ...this.req.reviewWords].map((x) => x.tl));
    const others = shuffle(
      this.req.allWords.filter(
        (o) => o.tl !== w.tl && !this.usedSentences.has(o.tl) && lower(o.ex[1]) !== lower(w.ex[1]),
      ),
      this.rand,
    )
      // Prefer sentences this lesson won't otherwise show, so wrong options don't spoil later exercises.
      .sort((a, b) => Number(inLesson.has(a.tl)) - Number(inLesson.has(b.tl)))
      .slice(0, 2);
    const draft = this.choice(
      w.ex[0],
      "tl",
      w.ex[1],
      others.map((o) => o.ex[1]),
    );
    if (draft) [w, ...others].forEach((o) => this.usedSentences.add(o.tl));
    return draft;
  }

  matchPairs(focus: CourseWord[]): Draft | null {
    const chosen: CourseWord[] = [];
    const candidates = [
      ...focus,
      ...shuffle(this.req.reviewWords, this.rand),
      ...shuffle(this.req.allWords, this.rand),
    ];
    for (const w of candidates) {
      if (chosen.length === 4) break;
      if (glossable(w) && !chosen.some((c) => overlaps(c, w))) chosen.push(w);
    }
    if (chosen.length < 3) return null;
    return { type: "match_pairs", payload: { pairs: chosen.map((w) => ({ tl: w.tl, en: w.en })) } };
  }

  fillBlank(w: CourseWord): Draft | null {
    if (this.usedSentences.has(w.tl)) return null;
    const [sentence, translation] = w.ex;
    // Whole-word, case-insensitive match of the headword inside its example sentence.
    const escaped = w.tl.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const match = new RegExp(`(^|[^\\p{L}])(${escaped})(?=$|[^\\p{L}])`, "iu").exec(sentence);
    if (!match) return null;
    const surface = match[2];
    const start = match.index + match[1].length;
    const blanked = sentence.slice(0, start) + "___" + sentence.slice(start + surface.length);
    // Prefer a different part of speech so only one option is grammatical. Skills where every
    // word shares a POS (numbers, family) fall back to same-POS words: the English translation
    // shown next to the sentence still makes exactly one option correct.
    const singleWord = (d: CourseWord) => !d.tl.includes(" ");
    let picks = this.distractors(w, 2, (d) => d.pos !== w.pos && singleWord(d));
    if (picks.length < 2) picks = this.distractors(w, 2, singleWord);
    // Match the answer's capital only when the blank opens the sentence.
    const wrong = picks.map((d) => {
      if (start === 0) return capitalizeLike(d.tl, surface);
      const asName = d.tl[0].toLocaleUpperCase() + d.tl.slice(1);
      return this.proper.has(asName) ? asName : d.tl; // "si Kuya", not "si kuya"
    });
    if (wrong.length < 2 || !this.claimSentence(w)) return null;
    const options = shuffle([surface, ...wrong], this.rand);
    return {
      type: "fill_blank",
      payload: { sentence: blanked, translation, options, answerIndex: options.indexOf(surface) },
    };
  }

  /** Extra tiles drawn from other example sentences that don't collide with any accepted answer. */
  private extraTiles(side: 0 | 1, exclude: string[][], count: number): string[] {
    const banned = new Set([...exclude.flat().map(lower), ...this.usedTiles]);
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
    const picked = pool.slice(0, count);
    picked.forEach((t) => this.usedTiles.add(lower(t)));
    return picked;
  }

  wordBankToTl(w: CourseWord): Draft | null {
    const answer = this.tilesOf(w.ex[0]);
    if (answer.length < 2 || !this.claimSentence(w)) return null;
    return {
      type: "word_bank",
      payload: { prompt: w.ex[1], promptLang: "en", answer, distractors: this.extraTiles(0, [answer], 3) },
    };
  }

  wordBankToEn(w: CourseWord): Draft | null {
    const answer = this.tilesOf(w.ex[1]);
    if (answer.length < 2 || !this.claimSentence(w)) return null;
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

  /** Hear the word (text-to-speech), pick its meaning. */
  listenWord(w: CourseWord): Draft | null {
    if (!glossable(w) || this.targets.has(w.tl)) return null;
    const wrong = this.distractors(w, 3, glossable).map((d) => d.en);
    if (wrong.length < 2 || !this.claimTarget(w)) return null;
    const options = shuffle([w.en, ...wrong], this.rand);
    return { type: "listen_select", payload: { audio: w.tl, options, answerIndex: options.indexOf(w.en) } };
  }

  /** Say the word's example sentence aloud. */
  speak(w: CourseWord): Draft | null {
    if (tiles(w.ex[0]).length > 8 || !this.claimSentence(w)) return null;
    return { type: "speak", payload: { text: w.ex[0], translation: w.ex[1] } };
  }

  /** Speak a sentence: prefer the lesson's words, then review words, then the rest of the skill. */
  speakAny(): Draft | null {
    for (const w of [...this.req.words, ...this.req.reviewWords, ...this.req.allWords]) {
      const d = this.speak(w);
      if (d) return d;
    }
    return null;
  }

  /** Read the lesson's dialogue and pick B's reply among the authored wrong ones. */
  dialogue(): Draft | null {
    const d = this.req.dialogues[0];
    if (!d) return null;
    const reply = d.lines[d.lines.length - 1];
    const options = shuffle([reply[1], ...d.wrong], this.rand);
    return {
      type: "dialogue",
      payload: {
        lines: d.lines.slice(0, -1).map(([speaker, tl, en]) => ({ speaker, tl, en })),
        options,
        answerIndex: options.indexOf(reply[1]),
        replyEn: reply[2],
      },
    };
  }

  typeToTl(w: CourseWord): Draft | null {
    if (!glossable(w)) return null;
    const synonyms = this.req.allWords.filter((o) => o.tl !== w.tl && meanings(o).has(lower(w.en))).map((o) => o.tl);
    return { type: "type_translation", payload: { prompt: w.en, promptLang: "en", answers: [w.tl, ...synonyms] } };
  }
}

type Make = (b: LessonBuilder, w: CourseWord) => Draft | null;
/** A recipe step: try `make` on each lesson word, starting at `word`, until one fits. */
type Slot = { make: Make; word: number };

/**
 * The lesson recipe. Recognition first (pick, listen), then building and producing
 * (tiles, dialogue, typing, speaking). A match-pairs round is dropped in after step three.
 */
const RECIPE: Slot[] = [
  // No picture exercises: emoji are too open to interpretation to have one right answer.
  { make: (b, w) => b.mcEnToTl(w), word: 0 },
  { make: (b, w) => b.mcTlToEn(w), word: 0 },
  { make: (b, w) => b.listenWord(w), word: 2 },
  { make: (b, w) => b.fillBlank(w), word: 2 },
  { make: (b, w) => b.wordBankToTl(w), word: 3 },
  { make: (b, w) => b.typeToEn(w), word: 4 },
  { make: (b) => b.dialogue(), word: 0 },
  { make: (b, w) => b.wordBankToEn(w), word: 0 },
  { make: (b) => b.speakAny(), word: 0 },
  { make: (b, w) => b.mcSentence(w), word: 1 },
  { make: (b, w) => b.fillBlank(w), word: 5 },
  { make: (b, w) => b.typeToTl(w), word: 2 },
];

export class StubGenerator implements ExerciseGenerator {
  readonly provider = "stub" as const;
  readonly model = "stub-templates-v2";

  async generate(req: GenerationRequest): Promise<GenerationResult> {
    const b = new LessonBuilder(req);
    const drafts: Draft[] = [];
    const words = req.words;

    const firstFit = (make: Make, start: number): Draft | null => {
      // Try the slot's word first, then the following words, until the template applies.
      for (let k = 0; k < words.length; k++) {
        const d = make(b, words[(start + k) % words.length]);
        if (d) return d;
      }
      return null;
    };
    RECIPE.forEach((slot, i) => {
      const d = firstFit(slot.make, slot.word);
      if (d) drafts.push(d);
      // Drop a match-pairs round in after the first three exercises.
      if (i === 2) {
        const mp = b.matchPairs(words);
        if (mp) drafts.push(mp);
      }
    });

    const exercises: ParsedExercise[] = [];
    const rejected: GenerationResult["rejected"] = [];
    const seen = new Set<string>();
    for (const d of drafts) {
      const key = JSON.stringify(d);
      if (seen.has(key)) continue; // a slot fell through to an exercise we already have
      seen.add(key);
      try {
        exercises.push(parseExercise(d.type, d.payload));
      } catch (e) {
        rejected.push({ raw: d, reason: e instanceof Error ? e.message : String(e) });
      }
    }
    return { exercises, rejected };
  }
}
