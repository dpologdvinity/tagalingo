import { describe, expect, it } from "vitest";
import { parseExercise } from "./schema";
import { toClientExercise } from "./client-view";

describe("toClientExercise", () => {
  it("never includes the answer index for multiple choice", () => {
    const view = toClientExercise(
      "ex1",
      parseExercise("select_translation", {
        prompt: "tubig",
        promptLang: "tl",
        options: ["rice", "water", "fish"],
        answerIndex: 1,
      }),
    );
    expect(view).toEqual({
      id: "ex1",
      type: "select_translation",
      prompt: "tubig",
      promptLang: "tl",
      options: ["rice", "water", "fish"],
    });
  });

  it("mixes word-bank answer tiles with distractors without revealing which is which", () => {
    const view = toClientExercise(
      "ex2",
      parseExercise("word_bank", {
        prompt: "I am hungry.",
        promptLang: "en",
        answer: ["gutom", "ako"],
        distractors: ["ikaw", "busog"],
      }),
    );
    expect(view.type).toBe("word_bank");
    if (view.type !== "word_bank") return;
    expect([...view.tiles].sort()).toEqual(["ako", "busog", "gutom", "ikaw"]);
    expect(JSON.stringify(view)).not.toContain("answer");
    expect(JSON.stringify(view)).not.toContain("distractors");
  });

  it("shuffles tiles deterministically per exercise id", () => {
    const ex = parseExercise("word_bank", {
      prompt: "x",
      promptLang: "en",
      answer: ["a", "b", "c", "d"],
      distractors: ["e", "f"],
    });
    expect(toClientExercise("same", ex)).toEqual(toClientExercise("same", ex));
  });

  it("hides accepted answers for typed translations", () => {
    const view = toClientExercise(
      "ex3",
      parseExercise("type_translation", { prompt: "thank you", promptLang: "en", answers: ["salamat"] }),
    );
    expect(JSON.stringify(view)).not.toContain("salamat");
  });

  it("keeps the English translation for fill in the blank so the blank is unambiguous", () => {
    const view = toClientExercise(
      "ex4",
      parseExercise("fill_blank", {
        sentence: "___ si Maria.",
        translation: "I am Maria.",
        options: ["Ako", "Estudyante", "Babae"],
        answerIndex: 0,
      }),
    );
    expect(view).toMatchObject({ translation: "I am Maria.", options: ["Ako", "Estudyante", "Babae"] });
    expect(JSON.stringify(view)).not.toContain("answerIndex");
  });
});
