import { describe, expect, it } from "vitest";
import { parseExercise } from "@/lib/content/schema";
import { gradeAnswer, levenshtein, normalizeAnswer } from "./grading";

describe("normalizeAnswer", () => {
  it("lowercases, strips punctuation, accents and hyphens, and collapses spaces", () => {
    expect(normalizeAnswer("  Kumusta  ka, PÔ?! ")).toBe("kumusta ka po");
    expect(normalizeAnswer("Mag-aral")).toBe("magaral");
  });
});

describe("levenshtein", () => {
  it("counts single-character edits", () => {
    expect(levenshtein("salamat", "salamat")).toBe(0);
    expect(levenshtein("salamat", "salamt")).toBe(1);
    expect(levenshtein("kitten", "sitting")).toBe(3);
  });
});

describe("gradeAnswer", () => {
  const mc = parseExercise("select_translation", {
    prompt: "tubig",
    promptLang: "tl",
    options: ["rice", "water", "fish", "bread"],
    answerIndex: 1,
  });

  it("grades multiple choice by index", () => {
    expect(gradeAnswer(mc, { choice: 1 })).toMatchObject({ correct: true });
    expect(gradeAnswer(mc, { choice: 0 })).toMatchObject({ correct: false, correctAnswer: "water" });
  });

  it("treats a malformed answer as wrong instead of throwing", () => {
    expect(gradeAnswer(mc, { text: "water" })).toMatchObject({ correct: false });
  });

  const wb = parseExercise("word_bank", {
    prompt: "I am hungry.",
    promptLang: "en",
    answer: ["Gutom", "na", "ako"],
    alternates: [["Nagugutom", "ako"]],
    distractors: ["ikaw", "busog"],
  });

  it("grades word bank against the answer and alternates, ignoring case", () => {
    expect(gradeAnswer(wb, { tokens: ["gutom", "na", "ako"] }).correct).toBe(true);
    expect(gradeAnswer(wb, { tokens: ["Nagugutom", "ako"] }).correct).toBe(true);
    expect(gradeAnswer(wb, { tokens: ["ako", "gutom"] })).toMatchObject({
      correct: false,
      correctAnswer: "Gutom na ako",
    });
  });

  const typed = parseExercise("type_translation", {
    prompt: "Thank you very much",
    promptLang: "en",
    answers: ["Maraming salamat", "Salamat nang marami"],
  });

  it("accepts any listed answer for typed translations", () => {
    expect(gradeAnswer(typed, { text: "salamat nang marami!" }).correct).toBe(true);
  });

  it("forgives a single typo on longer answers and flags it", () => {
    expect(gradeAnswer(typed, { text: "Maraming salamt" })).toMatchObject({ correct: true, typo: true });
  });

  it("does not forgive typos on very short answers", () => {
    const short = parseExercise("type_translation", { prompt: "yes", promptLang: "en", answers: ["oo"] });
    expect(gradeAnswer(short, { text: "o" }).correct).toBe(false);
  });

  it("accepts a completed match_pairs exercise", () => {
    const mp = parseExercise("match_pairs", {
      pairs: [
        { tl: "isa", en: "one" },
        { tl: "dalawa", en: "two" },
        { tl: "tatlo", en: "three" },
      ],
    });
    expect(gradeAnswer(mp, { completed: true }).correct).toBe(true);
    expect(gradeAnswer(mp, {}).correct).toBe(false);
  });

  it("grades fill in the blank by index and shows the full sentence when wrong", () => {
    const fb = parseExercise("fill_blank", {
      sentence: "Kumain ako ng ___.",
      translation: "I ate rice.",
      options: ["kanin", "tubig", "bahay"],
      answerIndex: 0,
    });
    expect(gradeAnswer(fb, { choice: 0 }).correct).toBe(true);
    expect(gradeAnswer(fb, { choice: 2 })).toMatchObject({ correct: false, correctAnswer: "Kumain ako ng kanin." });
  });
});

describe("gradeAnswer: v1.1 types", () => {
  it("grades listening and picture exercises by index and reveals what was said", () => {
    const listen = parseExercise("listen_select", {
      audio: "Gutom na ako.",
      options: ["I'm hungry.", "I'm tired."],
      answerIndex: 0,
    });
    expect(gradeAnswer(listen, { choice: 0 }).correct).toBe(true);
    expect(gradeAnswer(listen, { choice: 1 })).toMatchObject({
      correct: false,
      correctAnswer: "Gutom na ako. (I'm hungry.)",
    });

    const pic = parseExercise("select_picture", {
      prompt: "isda",
      pictures: ["🍚", "🐟", "☕"],
      labels: ["rice", "fish", "coffee"],
      answerIndex: 1,
    });
    expect(gradeAnswer(pic, { choice: 0 })).toMatchObject({ correct: false, correctAnswer: "🐟 fish" });
  });

  const speak = parseExercise("speak", { text: "Magandang umaga po.", translation: "Good morning." });

  it("accepts a close speech-recognition transcript", () => {
    expect(gradeAnswer(speak, { transcript: "magandang umaga po" }).correct).toBe(true);
    expect(gradeAnswer(speak, { transcript: "maganda umaga po" }).correct).toBe(true); // one dropped letter
  });

  it("rejects a transcript of something else", () => {
    expect(gradeAnswer(speak, { transcript: "salamat" }).correct).toBe(false);
  });

  it("treats “can't speak now” as a no-penalty skip", () => {
    expect(gradeAnswer(speak, { skipped: true })).toMatchObject({ correct: true, skipped: true });
  });

  it("grades dialogues by index", () => {
    const d = parseExercise("dialogue", {
      lines: [{ speaker: "A", tl: "Kumusta ka?", en: "How are you?" }],
      options: ["Paalam.", "Mabuti naman."],
      answerIndex: 1,
      replyEn: "I'm fine.",
    });
    expect(gradeAnswer(d, { choice: 1 }).correct).toBe(true);
    expect(gradeAnswer(d, { choice: 0 })).toMatchObject({ correct: false, correctAnswer: "Mabuti naman. (I'm fine.)" });
  });
});

describe("gradeAnswer: speech edge cases", () => {
  it("accepts a transcript with extra filler words around the full sentence", () => {
    const ex = parseExercise("speak", { text: "Salamat po.", translation: "Thank you." });
    expect(gradeAnswer(ex, { transcript: "ah salamat po talaga" }).correct).toBe(true);
  });

  it("is strict on very short phrases", () => {
    const ex = parseExercise("speak", { text: "Oo.", translation: "Yes." });
    expect(gradeAnswer(ex, { transcript: "oo" }).correct).toBe(true);
    expect(gradeAnswer(ex, { transcript: "o" }).correct).toBe(false);
    expect(gradeAnswer(ex, { transcript: "" }).correct).toBe(false);
  });
});
