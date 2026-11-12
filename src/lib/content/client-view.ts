/**
 * Learner-facing view of an exercise.
 *
 * The browser only ever receives this shape. Answers (answer indexes, accepted translations,
 * which word-bank tiles are distractors) stay on the server and grading happens in a server
 * action. The one exception is match_pairs, which needs the pairs to give instant per-tap
 * feedback; it awards no extra XP and costs no hearts, so there's nothing to gain by cheating.
 */
import { hash, rng, shuffle } from "@/lib/random";
import type { Affix, VerbForm } from "@/lib/grammar/types";
import type { ParsedExercise } from "./schema";

type Lang = "tl" | "en";

export type ClientExercise =
  | { id: string; type: "select_translation"; prompt: string; promptLang: Lang; options: string[] }
  | { id: string; type: "fill_blank"; sentence: string; translation: string; options: string[] }
  | { id: string; type: "word_bank"; prompt: string; promptLang: Lang; tiles: string[] }
  | { id: string; type: "match_pairs"; pairs: { tl: string; en: string }[] }
  | { id: string; type: "type_translation"; prompt: string; promptLang: Lang }
  | { id: string; type: "listen_select"; audio: string; options: string[] }
  | { id: string; type: "speak"; text: string; translation: string }
  | { id: string; type: "dialogue"; lines: { speaker: "A" | "B"; tl: string; en: string }[]; options: string[] }
  | { id: string; type: "conjugate"; sentence: string; translation: string; root: string; affix: Affix; form: VerbForm }
  | { id: string; type: "find_root"; word: string; translation?: string; mode: "choice" | "type"; options?: string[] }
  | {
      id: string;
      type: "transform";
      source: string;
      sourceEn: string;
      instruction: string;
      mode: "build" | "type";
      tiles?: string[];
    }
  | {
      id: string;
      type: "paradigm";
      root: string;
      affix: Affix;
      en: string;
      cells: { form: VerbForm; value: string | null }[];
      tiles: string[];
    };

export function toClientExercise(id: string, ex: ParsedExercise): ClientExercise {
  switch (ex.type) {
    case "select_translation": {
      const { prompt, promptLang, options } = ex.payload;
      return { id, type: ex.type, prompt, promptLang, options };
    }
    case "fill_blank": {
      const { sentence, translation, options } = ex.payload;
      return { id, type: ex.type, sentence, translation, options };
    }
    case "word_bank": {
      const { prompt, promptLang, answer, distractors } = ex.payload;
      // Stable per exercise so a page refresh doesn't reshuffle the tiles under the learner.
      const tiles = shuffle([...answer, ...distractors], rng(hash(id)));
      return { id, type: ex.type, prompt, promptLang, tiles };
    }
    case "match_pairs":
      return { id, type: ex.type, pairs: ex.payload.pairs };
    case "type_translation": {
      const { prompt, promptLang } = ex.payload;
      return { id, type: ex.type, prompt, promptLang };
    }
    case "listen_select":
      return { id, type: ex.type, audio: ex.payload.audio, options: ex.payload.options };
    case "speak":
      return { id, type: ex.type, text: ex.payload.text, translation: ex.payload.translation };
    case "dialogue":
      return { id, type: ex.type, lines: ex.payload.lines, options: ex.payload.options };
    case "conjugate": {
      const { sentence, translation, root, affix, form } = ex.payload;
      return { id, type: ex.type, sentence, translation, root, affix, form };
    }
    case "find_root": {
      const { word, translation, mode, options } = ex.payload;
      return {
        id,
        type: ex.type,
        word,
        mode,
        ...(translation !== undefined && { translation }),
        ...(options !== undefined && { options }),
      };
    }
    case "transform": {
      const { source, sourceEn, instruction, mode, answers, distractors } = ex.payload;
      const base = { id, type: ex.type, source, sourceEn, instruction, mode } as const;
      if (mode === "type") return base;
      return { ...base, tiles: shuffle([...answers[0]!, ...distractors], rng(hash(id))) };
    }
    case "paradigm": {
      const { root, affix, en, cells, distractors } = ex.payload;
      const hidden = cells.filter((c) => c.hidden).map((c) => c.value);
      return {
        id,
        type: ex.type,
        root,
        affix,
        en,
        cells: cells.map((c) => ({ form: c.form, value: c.hidden ? null : c.value })),
        tiles: shuffle([...hidden, ...distractors], rng(hash(id))),
      };
    }
  }
}
