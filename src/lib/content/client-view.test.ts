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

describe("toClientExercise: v1.1 types", () => {
  it("hides the answer for listening, picture and dialogue exercises", () => {
    const listen = toClientExercise(
      "l",
      parseExercise("listen_select", { audio: "Salamat.", options: ["Thanks.", "Bye."], answerIndex: 0 }),
    );
    expect(listen).toEqual({ id: "l", type: "listen_select", audio: "Salamat.", options: ["Thanks.", "Bye."] });

    const dialogue = toClientExercise(
      "d",
      parseExercise("dialogue", {
        lines: [{ speaker: "A", tl: "Kumusta?", en: "How are you?" }],
        options: ["Mabuti.", "Paalam."],
        answerIndex: 0,
        replyEn: "Fine.",
      }),
    );
    expect(dialogue).toEqual({
      id: "d",
      type: "dialogue",
      lines: [{ speaker: "A", tl: "Kumusta?", en: "How are you?" }],
      options: ["Mabuti.", "Paalam."],
    });
  });

  it("sends the sentence and its meaning for speaking exercises", () => {
    expect(toClientExercise("s", parseExercise("speak", { text: "Salamat po.", translation: "Thank you." }))).toEqual({
      id: "s",
      type: "speak",
      text: "Salamat po.",
      translation: "Thank you.",
    });
  });

  describe("grammar exercise types", () => {
    const mistakes = [{ answer: "WRONGKAIN", why: "MISTAKETEXT" }];
    const cases = [
      [
        "conjugate",
        {
          sentence: "___ ako.",
          translation: "I ate.",
          root: "kain",
          affix: "um",
          form: "completed",
          answers: ["KUMAIN"],
          mistakes,
        },
        ["KUMAIN", "WRONGKAIN", "MISTAKETEXT"],
      ],
      ["find_root", { word: "kumain", mode: "type", root: "ROOTKAIN", hint: "HINTTEXT" }, ["ROOTKAIN", "HINTTEXT"]],
      [
        "transform",
        {
          source: "Kumain ako.",
          sourceEn: "I ate.",
          instruction: "Change.",
          mode: "type",
          answers: [["ANSWERTOKEN"]],
          mistakes,
        },
        ["ANSWERTOKEN", "WRONGKAIN", "MISTAKETEXT"],
      ],
      [
        "paradigm",
        {
          root: "kain",
          affix: "um",
          en: "eat",
          cells: [
            { form: "infinitive", value: "kumain", hidden: false },
            { form: "completed", value: "HIDDENVALUE", hidden: true },
          ],
          distractors: ["x"],
        },
        ['"value":"HIDDENVALUE"'],
      ],
      [
        "fill_blank",
        {
          sentence: "Kumain ___.",
          translation: "t",
          options: ["a", "b", "c"],
          answerIndex: 0,
          why: [null, "WHYTEXT", "WHYTEXT2"],
        },
        ["WHYTEXT", "WHYTEXT2", '"answerIndex"', '"why"'],
      ],
    ] as const;

    it.each(cases)("%s never leaks answers, why or mistakes", (type, payload, secrets) => {
      const json = JSON.stringify(toClientExercise("ex1", parseExercise(type, payload)));
      for (const secret of secrets) expect(json).not.toContain(secret);
    });

    it("find_root hides the root, and the type mode has no options", () => {
      const choice = toClientExercise(
        "ex1",
        parseExercise("find_root", {
          word: "kumain",
          mode: "choice",
          options: ["kain", "kuman"],
          root: "kain",
          hint: "h",
        }),
      );
      expect(choice).toEqual({
        id: "ex1",
        type: "find_root",
        word: "kumain",
        mode: "choice",
        options: ["kain", "kuman"],
      });
      const typed = toClientExercise(
        "ex1",
        parseExercise("find_root", { word: "kumain", mode: "type", root: "kain", hint: "h" }),
      );
      expect(typed).toEqual({ id: "ex1", type: "find_root", word: "kumain", mode: "type" });
    });

    it("transform tiles exist only in build mode and are stable per id", () => {
      const p = { source: "s", sourceEn: "e", instruction: "i", answers: [["a", "b"]], distractors: ["c"] };
      const built = toClientExercise("ex1", parseExercise("transform", { ...p, mode: "build" }));
      const again = toClientExercise("ex1", parseExercise("transform", { ...p, mode: "build" }));
      expect(built).toEqual(again);
      expect(built.type === "transform" && [...(built.tiles ?? [])].sort()).toEqual(["a", "b", "c"]);
      const typed = toClientExercise("ex1", parseExercise("transform", { ...p, mode: "type" }));
      expect(typed).not.toHaveProperty("tiles");
    });

    it("paradigm nulls hidden cells and offers hidden values plus distractors as tiles", () => {
      const view = toClientExercise(
        "ex1",
        parseExercise("paradigm", {
          root: "kain",
          affix: "um",
          en: "eat",
          cells: [
            { form: "infinitive", value: "kumain", hidden: false },
            { form: "completed", value: "kumain", hidden: true },
            { form: "contemplated", value: "kakain", hidden: true },
          ],
          distractors: ["kinain"],
        }),
      );
      if (view.type !== "paradigm") throw new Error("wrong type");
      expect(view.cells).toEqual([
        { form: "infinitive", value: "kumain" },
        { form: "completed", value: null },
        { form: "contemplated", value: null },
      ]);
      expect([...view.tiles].sort()).toEqual(["kakain", "kinain", "kumain"]);
    });
  });
});
