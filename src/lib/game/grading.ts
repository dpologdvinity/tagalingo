/**
 * Answer grading. Pure and shared by the server action (authoritative) and tests.
 *
 * Learners' answers arrive as untrusted JSON; anything that does not match the expected shape
 * is graded as wrong rather than throwing, so a tampered request can't crash a lesson.
 */
import type { ParsedExercise } from "@/lib/content/schema";

export type GradeResult = {
  correct: boolean;
  /** Human-readable correct answer, shown in the feedback sheet. */
  correctAnswer: string;
  /** True when a typed answer was accepted despite a one-letter typo. */
  typo?: boolean;
};

/**
 * Canonical form used for comparisons: lower-case, accents removed (Tagalog sometimes marks
 * stress, e.g. "pô"), hyphens dropped ("mag-aral" == "magaral"), punctuation stripped and
 * whitespace collapsed.
 */
export function normalizeAnswer(input: string): string {
  return input
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLocaleLowerCase("en")
    .replace(/[-‐‑–—]/g, "")
    .replace(/[^\p{L}\p{N}\s']/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

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

/** Answers shorter than this must be exact (after normalisation): "oo" vs "o" is not a typo. */
const TYPO_MIN_LENGTH = 5;

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null;

function choiceOf(answer: unknown): number | null {
  return isRecord(answer) && Number.isInteger(answer.choice) ? (answer.choice as number) : null;
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
      const accepted = [ex.payload.answer, ...(ex.payload.alternates ?? [])].map((seq) => normalizeAnswer(seq.join(" ")));
      return { correct: accepted.includes(given), correctAnswer };
    }
    case "match_pairs": {
      const correctAnswer = ex.payload.pairs.map((p) => `${p.tl} = ${p.en}`).join(", ");
      return { correct: isRecord(answer) && answer.completed === true, correctAnswer };
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
  }
}
