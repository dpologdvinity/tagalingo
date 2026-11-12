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

describe("v1.1 exercise types", () => {
  it("accepts a listening exercise and rejects an out-of-range answer", () => {
    expect(
      parseExercise("listen_select", { audio: "Salamat po.", options: ["Thank you.", "Goodbye."], answerIndex: 0 })
        .type,
    ).toBe("listen_select");
    expect(() =>
      parseExercise("listen_select", { audio: "Salamat po.", options: ["Thank you."], answerIndex: 3 }),
    ).toThrow();
  });

  it("rejects picture exercises: emoji pictures are too ambiguous to grade fairly", () => {
    expect(() =>
      parseExercise("select_picture" as never, {
        prompt: "isda",
        pictures: ["🐟", "🍚", "☕"],
        labels: ["fish", "rice", "coffee"],
        answerIndex: 0,
      }),
    ).toThrow();
  });

  it("accepts a speaking exercise", () => {
    expect(parseExercise("speak", { text: "Magandang umaga po.", translation: "Good morning." }).type).toBe("speak");
  });

  it("accepts a dialogue and requires at least one line of context", () => {
    const ok = {
      lines: [{ speaker: "A", tl: "Kumusta ka?", en: "How are you?" }],
      options: ["Mabuti naman.", "Paalam."],
      answerIndex: 0,
      replyEn: "I'm fine.",
    };
    expect(parseExercise("dialogue", ok).type).toBe("dialogue");
    expect(() => parseExercise("dialogue", { ...ok, lines: [] })).toThrow();
  });

  it("warns about long speaking prompts", () => {
    const long = parseExercise("speak", {
      text: "Pupunta ako sa palengke bukas ng umaga kasama si Nanay at si Lola",
      translation: "x",
    });
    expect(lintExercise(long).join(" ")).toMatch(/long/i);
  });
});

describe("grammar exercise types", () => {
  const conjugate = {
    sentence: "___ ako ng kanin kahapon.",
    translation: "I ate rice yesterday.",
    root: "kain",
    affix: "um",
    form: "completed",
    answers: ["Kumain"],
  };
  const findRoot = { word: "kumain", mode: "choice", options: ["kain", "kuman", "umain"], root: "kain", hint: "um-" };
  const transform = {
    source: "Kumain ako.",
    sourceEn: "I ate.",
    instruction: "Make it contemplated.",
    mode: "build",
    answers: [["Kakain", "ako"]],
    distractors: ["kumain"],
  };
  const paradigm = {
    root: "kain",
    affix: "um",
    en: "eat",
    cells: [
      { form: "infinitive", value: "kumain", hidden: false },
      { form: "completed", value: "kumain", hidden: true },
      { form: "contemplated", value: "kakain", hidden: true },
    ],
    distractors: ["kinain"],
  };

  it("accepts valid payloads", () => {
    for (const [type, p] of [
      ["conjugate", conjugate],
      ["find_root", findRoot],
      ["transform", transform],
      ["paradigm", paradigm],
    ] as const)
      expect(parseExercise(type, p).type).toBe(type);
  });

  it("requires exactly one blank in a conjugate sentence and a known affix/form", () => {
    expect(() => parseExercise("conjugate", { ...conjugate, sentence: "Kain ako." })).toThrow(/blank/);
    expect(() => parseExercise("conjugate", { ...conjugate, sentence: "___ ___" })).toThrow(/blank/);
    expect(() => parseExercise("conjugate", { ...conjugate, affix: "zzz" })).toThrow(/affix/);
    expect(() => parseExercise("conjugate", { ...conjugate, form: "past" })).toThrow();
    expect(() => parseExercise("conjugate", { ...conjugate, answers: [] })).toThrow();
  });

  it("find_root needs options iff choice mode, and options must contain the root", () => {
    expect(() => parseExercise("find_root", { ...findRoot, options: ["kuman", "umain"] })).toThrow(/root/);
    expect(() => parseExercise("find_root", { ...findRoot, options: undefined })).toThrow(/options/);
    expect(() => parseExercise("find_root", { ...findRoot, mode: "type" })).toThrow(/options/);
    expect(parseExercise("find_root", { ...findRoot, mode: "type", options: undefined }).type).toBe("find_root");
  });

  it("transform defaults distractors and needs at least one answer", () => {
    const rest = { ...transform, distractors: undefined };
    expect(parseExercise("transform", rest).payload).toMatchObject({ distractors: [] });
    expect(() => parseExercise("transform", { ...transform, answers: [] })).toThrow();
  });

  it("paradigm needs two cells with at least one hidden", () => {
    const shown = paradigm.cells.map((c) => ({ ...c, hidden: false }));
    expect(() => parseExercise("paradigm", { ...paradigm, cells: shown })).toThrow(/hidden/);
    expect(() => parseExercise("paradigm", { ...paradigm, cells: shown.slice(0, 1) })).toThrow();
  });

  it("validates why alignment on option-based exercises", () => {
    const base = { prompt: "tubig", promptLang: "tl", options: ["rice", "water", "fish"], answerIndex: 1 };
    expect(parseExercise("select_translation", { ...base, why: ["no", null, "no"] }).type).toBe("select_translation");
    expect(() => parseExercise("select_translation", { ...base, why: ["no", null] })).toThrow(/why/);
    expect(() => parseExercise("select_translation", { ...base, why: ["no", "yes", "no"] })).toThrow(/why/);
  });

  it("accepts mistakes on typed and built answers", () => {
    const m = [{ answer: "kain", why: "Needs the um- infix." }];
    expect(parseExercise("conjugate", { ...conjugate, mistakes: m }).type).toBe("conjugate");
    expect(parseExercise("type_translation", { prompt: "x", promptLang: "en", answers: ["y"], mistakes: m }).type).toBe(
      "type_translation",
    );
  });

  it("lints answers that leak, no-op transforms and duplicate paradigm tiles", () => {
    const leak = parseExercise("conjugate", { ...conjugate, translation: "Kumain: I ate rice." });
    expect(lintExercise(leak).join(" ")).toMatch(/answer appears/i);
    expect(lintExercise(parseExercise("conjugate", conjugate))).toEqual([]);
    const noop = parseExercise("transform", { ...transform, answers: [["Kumain", "ako."]] });
    expect(lintExercise(noop).join(" ")).toMatch(/source/i);
    const dup = parseExercise("paradigm", { ...paradigm, distractors: ["kakain"] });
    expect(lintExercise(dup).join(" ")).toMatch(/duplicate tiles/i);
    expect(lintExercise(parseExercise("paradigm", paradigm))).toEqual([]);
  });
});
