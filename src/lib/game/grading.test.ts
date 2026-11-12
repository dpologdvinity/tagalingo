import { describe, expect, it } from "vitest";
import { parseExercise } from "@/lib/content/schema";
import { gradeAnswer, levenshtein, normalizeAnswer } from "./grading";
import type { VerbTableData } from "@/lib/grammar/analyse";

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

describe("gradeAnswer: grammar drills", () => {
  const kain: VerbTableData = {
    root: "kain",
    affix: "um",
    en: "eat",
    forms: {
      infinitive: ["kumain"],
      completed: ["kumain"],
      incompleted: ["kumakain"],
      contemplated: ["kakain"],
      recent: ["kakakain"],
    },
  };
  const conj = (answers: string[], extra: object = {}) =>
    parseExercise("conjugate", {
      sentence: "___ ako bukas.",
      translation: "I will eat tomorrow.",
      root: "kain",
      affix: "um",
      form: "contemplated",
      answers,
      ...extra,
    });

  it("conjugate is strict", () => {
    const ex = conj(["kakain"]);
    expect(gradeAnswer(ex, { text: "kakain" }).correct).toBe(true);
    expect(gradeAnswer(ex, { text: "kakan" })).toMatchObject({ correct: false, correctAnswer: "kakain" });
    expect(gradeAnswer(ex, { text: "kakan" }).typo).toBeUndefined();
  });

  it("strict morphology still normalises case and hyphens", () => {
    const ex = conj(["mag-aaral"]);
    expect(gradeAnswer(ex, { text: "Mag-aaral" }).correct).toBe(true);
    expect(gradeAnswer(ex, { text: "magaaral" }).correct).toBe(true);
    expect(gradeAnswer(conj(["kumain"]), { text: "kakain" }).correct).toBe(false);
  });

  it("conjugate names the wrong form", () => {
    const result = gradeAnswer(conj(["kakain"]), { text: "kumakain" }, { verbTables: [kain] });
    expect(result.explanation).toBe("That's the present form (kumakain). The future is kakain.");
  });

  it("wrong-form explanation picks the first non-target form when several match", () => {
    const result = gradeAnswer(conj(["kakain"]), { text: "kumain" }, { verbTables: [kain] });
    expect(result.explanation).toBe("That's the infinitive / command form (kumain). The future is kakain.");
  });

  it("wrong-form explanation ignores other verbs and affixes", () => {
    const other: VerbTableData = { ...kain, affix: "in" };
    expect(gradeAnswer(conj(["kakain"]), { text: "kumakain" }, { verbTables: [other] }).explanation).toBeUndefined();
    expect(gradeAnswer(conj(["kakain"]), { text: "kakan" }, { verbTables: [kain] }).explanation).toBeUndefined();
  });

  it("known mistakes explain", () => {
    const ex = parseExercise("type_translation", {
      prompt: "I eat.",
      promptLang: "en",
      answers: ["Kumakain ako."],
      mistakes: [{ answer: "Kain ako.", why: "Use the -um- form." }],
    });
    expect(gradeAnswer(ex, { text: "kain ako" }).explanation).toBe("Use the -um- form.");
    const plain = parseExercise("type_translation", { prompt: "I eat.", promptLang: "en", answers: ["Kumakain ako."] });
    const ctx = { patternMistakes: [["Kain ako.", "Pattern why."]] as [string, string][] };
    expect(gradeAnswer(plain, { text: "Kain ako." }, ctx).explanation).toBe("Pattern why.");
    expect(gradeAnswer(plain, { text: "Kain ako." }).explanation).toBeUndefined();
  });

  it("exercise mistakes beat pattern mistakes, and wrong form beats both", () => {
    const ex = conj(["kakain"], { mistakes: [{ answer: "kumakain", why: "Exercise why." }] });
    const ctx = { verbTables: [kain], patternMistakes: [["kumakain", "Pattern why."]] as [string, string][] };
    expect(gradeAnswer(ex, { text: "kumakain" }, ctx).explanation).toMatch(/^That's the present form/);
    expect(gradeAnswer(ex, { text: "kumakain" }, { patternMistakes: ctx.patternMistakes }).explanation).toBe(
      "Exercise why.",
    );
  });

  it("per-option why", () => {
    const ex = parseExercise("fill_blank", {
      sentence: "___ ako.",
      translation: "I eat.",
      options: ["Kakain", "Kumakain"],
      answerIndex: 0,
      why: [null, "That is the present form."],
    });
    expect(gradeAnswer(ex, { choice: 1 }).explanation).toBe("That is the present form.");
    expect(gradeAnswer(ex, { choice: 0 }).explanation).toBeUndefined();
  });

  it("paradigm lists wrong cells", () => {
    const ex = parseExercise("paradigm", {
      root: "kain",
      affix: "um",
      en: "eat",
      cells: [
        { form: "infinitive", value: "kumain", hidden: false },
        { form: "incompleted", value: "kumakain", hidden: true },
        { form: "contemplated", value: "kakain", hidden: true },
      ],
      distractors: [],
    });
    expect(gradeAnswer(ex, { cells: { incompleted: "kumakain", contemplated: "kumain" } })).toMatchObject({
      correct: false,
      wrongCells: ["contemplated"],
    });
    const ok = gradeAnswer(ex, { cells: { incompleted: "Kumakain", contemplated: "kakain" } });
    expect(ok.correct).toBe(true);
    expect(ok.wrongCells).toBeUndefined();
    expect(gradeAnswer(ex, { cells: {} }).wrongCells).toEqual(["incompleted", "contemplated"]);
    expect(gradeAnswer(ex, "junk")).toMatchObject({ correct: false });
  });

  it("transform accepts any listed sequence", () => {
    const base = {
      source: "Kumain ako.",
      sourceEn: "I ate.",
      instruction: "Make it future",
      answers: [
        ["Kakain", "ako"],
        ["Ako", "ay", "kakain"],
      ],
    };
    const build = parseExercise("transform", { ...base, mode: "build", distractors: ["kain"] });
    expect(gradeAnswer(build, { tokens: ["Ako", "ay", "kakain"] }).correct).toBe(true);
    expect(gradeAnswer(build, { tokens: ["kakain", "ako"] }).correct).toBe(true);
    expect(gradeAnswer(build, { tokens: ["ako", "kakain"] }).correct).toBe(false);
    const typed = parseExercise("transform", { ...base, mode: "type" });
    expect(gradeAnswer(typed, { text: "ako ay kakain." }).correct).toBe(true);
    expect(gradeAnswer(typed, { text: "ako kakain" }).correct).toBe(false);
  });

  it("find_root explains with the hint on a wrong answer", () => {
    const choice = parseExercise("find_root", {
      word: "kumakain",
      mode: "choice",
      options: ["Kain", "kakain"],
      root: "kain",
      hint: "Drop the -um- and the repeated syllable.",
    });
    // Option text may differ from root by case; grading compares normalised.
    expect(gradeAnswer(choice, { choice: 0 }).correct).toBe(true);
    expect(gradeAnswer(choice, { choice: 1 })).toMatchObject({
      correct: false,
      explanation: "Drop the -um- and the repeated syllable.",
    });
    const typed = parseExercise("find_root", { word: "kumakain", mode: "type", root: "kain", hint: "Hint." });
    expect(gradeAnswer(typed, { text: "KAIN" })).toMatchObject({ correct: true });
    expect(gradeAnswer(typed, { text: "kakain" })).toMatchObject({ correct: false, explanation: "Hint." });
  });
});
