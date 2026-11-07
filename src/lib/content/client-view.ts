/**
 * Learner-facing view of an exercise.
 *
 * The browser only ever receives this shape. Answers (answer indexes, accepted translations,
 * which word-bank tiles are distractors) stay on the server and grading happens in a server
 * action. The one exception is match_pairs, which needs the pairs to give instant per-tap
 * feedback; it awards no extra XP and costs no hearts, so there's nothing to gain by cheating.
 */
import { hash, rng, shuffle } from "@/lib/random";
import type { ParsedExercise } from "./schema";

type Lang = "tl" | "en";

export type ClientExercise =
  | { id: string; type: "select_translation"; prompt: string; promptLang: Lang; options: string[] }
  | { id: string; type: "fill_blank"; sentence: string; translation: string; options: string[] }
  | { id: string; type: "word_bank"; prompt: string; promptLang: Lang; tiles: string[] }
  | { id: string; type: "match_pairs"; pairs: { tl: string; en: string }[] }
  | { id: string; type: "type_translation"; prompt: string; promptLang: Lang };

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
  }
}
