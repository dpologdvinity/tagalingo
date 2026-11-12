/**
 * Answer grading. Pure and shared by the server action (authoritative) and tests.
 *
 * Learners' answers arrive as untrusted JSON; anything that does not match the expected shape
 * is graded as wrong rather than throwing, so a tampered request can't crash a lesson.
 */
import type { ParsedExercise } from "@/lib/content/schema";
import { normalizeAnswer } from "@/lib/normalize";

// Re-exported so existing `@/lib/game/grading` imports keep working.
export { normalizeAnswer };

export type GradeResult = {
  correct: boolean;
  /** Human-readable correct answer, shown in the feedback sheet. */
  correctAnswer: string;
  /** True when a typed answer was accepted despite a one-letter typo. */
  typo?: boolean;
  /** True when a speaking exercise was skipped ("can't speak now"): counts as done, no penalty. */
  skipped?: boolean;
};

/** Classic edit distance (insert/delete/substitute), O(n·m) with a single row. */
export function levenshtein(a: string, b: string): number {
  if (a === b) return 0;
  const row = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    let prev = row[0];
    row[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const tmp = row[j];
      row[j] = Math.min(row[j] + 1, row[j - 1] + 1, prev + (a[i - 1] === b[j - 1] ? 0 : 1));
      prev = tmp;
    }
  }
  return row[b.length];
}

/** 0–1 similarity of two normalised strings (1 = identical). */
export function similarity(a: string, b: string): number {
  const x = normalizeAnswer(a);
  const y = normalizeAnswer(b);
  const longest = Math.max(x.length, y.length);
  return longest === 0 ? 1 : 1 - levenshtein(x, y) / longest;
}

/** Speech recognition mishears small things; this much similarity counts as saying it right. */
export const SPEECH_MATCH_THRESHOLD = 0.75;

/** Answers shorter than this must be exact (after normalisation): "oo" vs "o" is not a typo. */
const TYPO_MIN_LENGTH = 5;

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null;

function choiceOf(answer: unknown): number | null {
  return isRecord(answer) && Number.isInteger(answer.choice) ? (answer.choice as number) : null;
}

/** True when `answer` is `{ text }` and its normalised text equals one of `accepted`. */
function textMatches(answer: unknown, accepted: string[]): boolean {
  if (!isRecord(answer) || typeof answer.text !== "string") return false;
  const given = normalizeAnswer(answer.text);
  return given !== "" && accepted.some((a) => normalizeAnswer(a) === given);
}

export function gradeAnswer(ex: ParsedExercise, answer: unknown): GradeResult {
  switch (ex.type) {
    case "select_translation": {
      const correctAnswer = ex.payload.options[ex.payload.answerIndex];
      return { correct: choiceOf(answer) === ex.payload.answerIndex, correctAnswer };
    }
    case "fill_blank": {
      const word = ex.payload.options[ex.payload.answerIndex];
      return {
        correct: choiceOf(answer) === ex.payload.answerIndex,
        correctAnswer: ex.payload.sentence.replace("___", word),
      };
    }
    case "word_bank": {
      const correctAnswer = ex.payload.answer.join(" ");
      const tokens =
        isRecord(answer) && Array.isArray(answer.tokens) && answer.tokens.every((t) => typeof t === "string")
          ? (answer.tokens as string[])
          : null;
      if (!tokens) return { correct: false, correctAnswer };
      const given = normalizeAnswer(tokens.join(" "));
      const accepted = [ex.payload.answer, ...(ex.payload.alternates ?? [])].map((seq) =>
        normalizeAnswer(seq.join(" ")),
      );
      return { correct: accepted.includes(given), correctAnswer };
    }
    case "match_pairs": {
      const correctAnswer = ex.payload.pairs.map((p) => `${p.tl} = ${p.en}`).join(", ");
      return { correct: isRecord(answer) && answer.completed === true, correctAnswer };
    }
    case "listen_select":
      return {
        correct: choiceOf(answer) === ex.payload.answerIndex,
        correctAnswer: `${ex.payload.audio} (${ex.payload.options[ex.payload.answerIndex]})`,
      };
    case "dialogue":
      return {
        correct: choiceOf(answer) === ex.payload.answerIndex,
        correctAnswer: `${ex.payload.options[ex.payload.answerIndex]} (${ex.payload.replyEn})`,
      };
    case "speak": {
      const correctAnswer = ex.payload.text;
      if (isRecord(answer) && answer.skipped === true) return { correct: true, skipped: true, correctAnswer };
      if (!isRecord(answer) || typeof answer.transcript !== "string") return { correct: false, correctAnswer };
      const heard = normalizeAnswer(answer.transcript);
      const target = normalizeAnswer(ex.payload.text);
      // Recognisers often add filler ("ah …") around a correct sentence; accept the full
      // sentence inside the transcript for multi-word targets. Short phrases must match closely.
      const contained = target.includes(" ") && ` ${heard} `.includes(` ${target} `);
      return {
        correct: heard.length > 0 && (contained || similarity(heard, target) >= SPEECH_MATCH_THRESHOLD),
        correctAnswer,
      };
    }
    case "type_translation": {
      const correctAnswer = ex.payload.answers[0];
      if (!isRecord(answer) || typeof answer.text !== "string") return { correct: false, correctAnswer };
      const given = normalizeAnswer(answer.text);
      if (!given) return { correct: false, correctAnswer };
      const accepted = ex.payload.answers.map(normalizeAnswer);
      if (accepted.includes(given)) return { correct: true, correctAnswer };
      const nearMiss = accepted.find((a) => a.length >= TYPO_MIN_LENGTH && levenshtein(a, given) === 1);
      if (nearMiss !== undefined) {
        return { correct: true, typo: true, correctAnswer: ex.payload.answers[accepted.indexOf(nearMiss)] };
      }
      return { correct: false, correctAnswer };
    }
    // Exact normalised match only; Task 6 refines these (near-miss handling, mistake explanations).
    case "conjugate": {
      const correctAnswer = ex.payload.answers[0]!;
      return { correct: textMatches(answer, ex.payload.answers), correctAnswer };
    }
    case "find_root":
      return {
        correct:
          ex.payload.mode === "choice"
            ? isRecord(answer) && ex.payload.options?.[choiceOf(answer) ?? -1] === ex.payload.root
            : textMatches(answer, [ex.payload.root]),
        correctAnswer: ex.payload.root,
      };
    case "transform": {
      const correctAnswer = ex.payload.answers[0]!.join(" ");
      const given =
        isRecord(answer) && Array.isArray(answer.tokens) && answer.tokens.every((t) => typeof t === "string")
          ? (answer.tokens as string[]).join(" ")
          : isRecord(answer) && typeof answer.text === "string"
            ? answer.text
            : null;
      if (given === null) return { correct: false, correctAnswer };
      return {
        correct: ex.payload.answers.some((a) => normalizeAnswer(a.join(" ")) === normalizeAnswer(given)),
        correctAnswer,
      };
    }
    case "paradigm": {
      const hidden = ex.payload.cells.filter((c) => c.hidden).map((c) => c.value);
      const values =
        isRecord(answer) && Array.isArray(answer.values) && answer.values.every((t) => typeof t === "string")
          ? (answer.values as string[])
          : null;
      return {
        correct:
          values !== null &&
          values.length === hidden.length &&
          hidden.every((h, i) => normalizeAnswer(h) === normalizeAnswer(values[i]!)),
        correctAnswer: hidden.join(", "),
      };
    }
  }
}
