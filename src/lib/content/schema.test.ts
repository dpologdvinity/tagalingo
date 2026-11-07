import { describe, expect, it } from "vitest";
import { lintExercise, parseExercise } from "./schema";

describe("parseExercise", () => {
  it("accepts a valid select_translation payload", () => {
    const ex = parseExercise("select_translation", {
      prompt: "salamat",
      promptLang: "tl",
      options: ["thank you", "hello", "goodbye", "please"],
      answerIndex: 0,
    });
    expect(ex.type).toBe("select_translation");
  });

  it("rejects an answerIndex outside the options", () => {
    expect(() =>
      parseExercise("select_translation", {
        prompt: "salamat",
        promptLang: "tl",
        options: ["thank you", "hello"],
        answerIndex: 2,
      }),
    ).toThrow(/answerIndex/);
  });

  it("rejects a fill_blank sentence without a blank", () => {
    expect(() =>
      parseExercise("fill_blank", {
        sentence: "Kumain ako ng kanin.",
        translation: "I ate rice.",
        options: ["kanin", "tubig"],
        answerIndex: 0,
      }),
    ).toThrow(/___/);
  });

  it("rejects unknown exercise types", () => {
    expect(() => parseExercise("listen" as never, {})).toThrow();
  });
});

describe("lintExercise", () => {
  it("flags duplicate options", () => {
    const warnings = lintExercise(
      parseExercise("select_translation", {
        prompt: "oo",
        promptLang: "tl",
        options: ["yes", "Yes", "no"],
        answerIndex: 0,
      }),
    );
    expect(warnings.join(" ")).toMatch(/duplicate/i);
  });

  it("flags word_bank distractors that also appear in the answer", () => {
    const warnings = lintExercise(
      parseExercise("word_bank", {
        prompt: "Good morning",
        promptLang: "en",
        answer: ["Magandang", "umaga"],
        distractors: ["umaga", "gabi"],
      }),
    );
    expect(warnings.join(" ")).toMatch(/distractor/i);
  });

  it("returns no warnings for a clean exercise", () => {
    const warnings = lintExercise(
      parseExercise("match_pairs", {
        pairs: [
          { tl: "isa", en: "one" },
          { tl: "dalawa", en: "two" },
          { tl: "tatlo", en: "three" },
        ],
      }),
    );
    expect(warnings).toEqual([]);
  });
});
