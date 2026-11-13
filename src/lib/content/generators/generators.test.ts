import { describe, expect, it } from "vitest";
import path from "node:path";
import { loadCourseFile, lessonRequest } from "../course";
import { lintExercise, parseExercise } from "../schema";
import { StubGenerator } from "./stub";
import { ClaudeGenerator, type MessagesClient } from "./claude";
import { selectGenerator } from "./index";
import { buildGrammarDrills, checkDrill, MAX_GRAMMAR_DRILLS } from "./grammar-drills";
import type { TaggedExercise } from "./types";
import type { VerbTableData } from "@/lib/grammar/analyse";
import { conjugate, type VerbEntry } from "@/lib/grammar/morphology";
import type { CoursePattern, Frame } from "../grammar-schema";

const course = loadCourseFile(path.join(process.cwd(), "content/tagalog/course.yaml"));
const allRequests = course.units.flatMap((u) =>
  u.skills.flatMap((s) => s.lessons.map((_, i) => lessonRequest(course, s, i))),
);

describe("StubGenerator", () => {
  const stub = new StubGenerator();

  it("produces a valid, mixed lesson of 8–14 exercises for every lesson in the course", async () => {
    for (const req of allRequests) {
      const { exercises } = await stub.generate(req);
      expect(exercises.length, req.lesson.title).toBeGreaterThanOrEqual(8);
      expect(exercises.length, req.lesson.title).toBeLessThanOrEqual(14);
      for (const ex of exercises) expect(() => parseExercise(ex.type, ex.payload)).not.toThrow();
      expect(new Set(exercises.map((e) => e.type)).size, req.lesson.title).toBeGreaterThanOrEqual(4);
    }
  });

  it("adds listening and speaking practice to every lesson", async () => {
    for (const req of allRequests) {
      const types = new Set((await stub.generate(req)).exercises.map((e) => e.type));
      expect(types.has("listen_select"), req.lesson.title).toBe(true);
      expect(types.has("speak"), req.lesson.title).toBe(true);
    }
  });

  it("turns each lesson's dialogue into a pick-the-reply exercise with the authored wrong replies", async () => {
    for (const req of allRequests) {
      for (const d of req.dialogues) {
        const ex = (await stub.generate(req)).exercises.find((e) => e.type === "dialogue");
        expect(ex, req.lesson.title).toBeDefined();
        if (ex?.type !== "dialogue") continue;
        const reply = d.lines[d.lines.length - 1];
        expect(ex.payload.options[ex.payload.answerIndex]).toBe(reply[1]);
        expect([...ex.payload.options].sort()).toEqual([reply[1], ...d.wrong].sort());
        expect(ex.payload.lines).toHaveLength(d.lines.length - 1);
      }
    }
  });

  it("never uses the same word as the target of two recognition exercises in a lesson", async () => {
    for (const req of allRequests) {
      const targets: string[] = [];
      for (const ex of (await stub.generate(req)).exercises) {
        if (ex.type === "listen_select") targets.push(ex.payload.audio);
        if (ex.type === "select_translation" && !ex.payload.prompt.includes(" ")) targets.push(ex.payload.prompt);
      }
      expect(new Set(targets).size, `${req.lesson.title}: ${targets.join(", ")}`).toBe(targets.length);
    }
  });

  it("is deterministic for the same lesson", async () => {
    const a = await stub.generate(allRequests[0]);
    const b = await stub.generate(allRequests[0]);
    expect(a).toEqual(b);
  });

  it("never puts the answer among multiple-choice distractors twice and keeps lint clean", async () => {
    for (const req of allRequests) {
      const { exercises } = await stub.generate(req);
      for (const ex of exercises) {
        const warnings = lintExercise(ex).filter((w) => !w.startsWith("Only two options"));
        expect(warnings, `${req.lesson.title}: ${JSON.stringify(ex)}`).toEqual([]);
      }
    }
  });

  it("lowercases sentence-initial word-bank tiles so capitals don't give away the answer", async () => {
    for (const req of allRequests) {
      const { exercises } = await stub.generate(req);
      for (const ex of exercises) {
        if (ex.type !== "word_bank") continue;
        // Proper nouns: "I"-forms, capitalised headwords (Pilipino, Lunes) and words written
        // capitalised mid-sentence somewhere in the skill (Ana, Lola, Cebu).
        const midSentence = (x: string) =>
          x
            .split(/\s+/)
            .slice(1)
            .map((y) => y.replace(/[^\p{L}'-]/gu, ""));
        const isProper = (t: string) =>
          /^I('|$)/.test(t) ||
          req.allWords.some(
            (w) => w.tl === t || [w.ex[0], w.ex[1], ...w.exAccept].some((x) => midSentence(x).includes(t)),
          );
        for (const t of [...ex.payload.answer, ...ex.payload.distractors]) {
          if (t[0] !== t[0].toLowerCase()) expect(isProper(t), `${t} in ${JSON.stringify(ex.payload)}`).toBe(true);
        }
      }
    }
  });

  it("prefers fill-in-the-blank distractors with a different part of speech", async () => {
    const req = allRequests[0]; // pagbati mixes phrases, particles and adjectives
    const { exercises } = await stub.generate(req);
    const posOf = new Map(req.allWords.map((w) => [w.tl.toLowerCase(), w.pos]));
    for (const ex of exercises) {
      if (ex.type !== "fill_blank") continue;
      const answerPos = posOf.get(ex.payload.options[ex.payload.answerIndex].toLowerCase());
      ex.payload.options.forEach((o, i) => {
        if (i !== ex.payload.answerIndex) expect(posOf.get(o.toLowerCase())).not.toBe(answerPos);
      });
    }
  });

  it("includes at least one fill-in-the-blank in every lesson, even single-POS skills", async () => {
    for (const req of allRequests) {
      const { exercises } = await stub.generate(req);
      expect(
        exercises.some((e) => e.type === "fill_blank"),
        `${req.skill.slug} ${req.lesson.title}`,
      ).toBe(true);
    }
  });

  it("never repeats an exercise or reuses an example sentence within a lesson", async () => {
    for (const req of allRequests) {
      const { exercises } = await stub.generate(req);
      const keys = exercises.map((e) => JSON.stringify(e));
      expect(new Set(keys).size, req.lesson.title).toBe(keys.length);
      const sentences = req.allWords.map((w) => w.ex);
      const used = new Map<number, number>();
      for (const e of exercises) {
        const text = JSON.stringify(e.payload).toLowerCase();
        sentences.forEach(([tl, en], i) => {
          const tiles = (s: string) => s.toLowerCase().replace(/[^\p{L}\p{N}' ]/gu, "");
          if (e.type === "match_pairs") return;
          const hits =
            text.includes(JSON.stringify(tl.toLowerCase())) ||
            text.includes(JSON.stringify(en.toLowerCase())) ||
            (e.type === "word_bank" &&
              (tiles(e.payload.answer.join(" ")) === tiles(tl) || tiles(e.payload.answer.join(" ")) === tiles(en)));
          if (hits) used.set(i, (used.get(i) ?? 0) + 1);
        });
      }
      for (const [i, n] of used) expect(n, `${req.lesson.title}: "${sentences[i][0]}" used ${n}×`).toBe(1);
    }
  });

  it("only capitalises fill-in-the-blank options when the blank starts the sentence", async () => {
    for (const req of allRequests) {
      const { exercises } = await stub.generate(req);
      for (const ex of exercises) {
        if (ex.type !== "fill_blank" || ex.payload.sentence.startsWith("___")) continue;
        const answer = ex.payload.options[ex.payload.answerIndex];
        ex.payload.options.forEach((o, i) => {
          if (i === ex.payload.answerIndex) return;
          // Allowed: capitalised headwords (Lunes) and words used as names elsewhere ("si Kuya").
          const usedAsName = req.allWords.some(
            (w) => w.tl === o || w.ex.some((sentence) => new RegExp(`\\s${o}\\b`, "u").test(sentence)),
          );
          if (!usedAsName) expect(o[0], `${ex.payload.sentence} (${answer})`).toBe(o[0].toLowerCase());
          expect(o).not.toBe("kuya"); // regression: should read "Kuya" after "si"
        });
      }
    }
  });

  it("does not reuse the same distractor tile across word banks in a lesson", async () => {
    for (const req of allRequests) {
      const { exercises } = await stub.generate(req);
      const seen = new Set<string>();
      for (const ex of exercises) {
        if (ex.type !== "word_bank") continue;
        for (const t of ex.payload.distractors) {
          expect(seen.has(t.toLowerCase()), `${req.lesson.title}: tile "${t}" reused`).toBe(false);
          seen.add(t.toLowerCase());
        }
      }
    }
  });
});

describe("grammar drills", () => {
  const stub = new StubGenerator();

  const kainEntry: VerbEntry = { root: "kain", en: "to eat", affixes: ["um"], glottal: false, stem: null, forms: {} };
  const kain: VerbTableData = { root: "kain", affix: "um", en: "to eat", forms: conjugate(kainEntry, "um") };

  const frame = (sentence: string, form: Frame[3]): Frame => [sentence, "English.", "um", form];
  const umAspect: CoursePattern = {
    id: "um-aspect",
    title: "Aspect with -um-",
    rule: "Rule.",
    table: undefined,
    examples: [
      ["Kumain ako ng isda.", "I ate fish."],
      ["Kakain siya ng isda.", "She will eat fish."],
    ],
    notes: [],
    mistakes: [],
    requires: [],
    drills: {
      frames: [frame("___ ako ng isda.", "completed"), frame("___ siya ng isda.", "incompleted")],
      transforms: [["Kumain ako ng isda.", "I ate fish.", "Change to the future.", ["Kakain ako ng isda."]]],
      choices: [
        [
          "___ siya ng isda kahapon.",
          "She ate fish yesterday.",
          ["kumain", "kakain", "kumakain"],
          0,
          [null, "Kakain is the future; kahapon means yesterday.", "Kumakain is ongoing."],
        ],
      ],
    },
  };

  /** A lesson that teaches `teaches` (and revisits `uses`), built on the first lesson of the shipped course. */
  const lessonWith = (teaches: CoursePattern[], uses: CoursePattern[] = []) => ({
    ...allRequests[0],
    grammar: {
      teaches,
      uses,
      verbs: [kainEntry],
      knownWords: ["isda", "kahapon"],
      verbTables: [],
    },
  });
  const rand = () => 0.5;

  it("adds tagged grammar drills to lessons that teach a pattern", async () => {
    const { exercises, rejected } = await stub.generate(lessonWith([umAspect]), [kain]);
    expect(rejected).toEqual([]);
    const conjugations = exercises.filter((e) => e.type === "conjugate");
    expect(conjugations.length).toBeGreaterThanOrEqual(1);
    for (const e of conjugations) {
      if (e.type !== "conjugate") continue;
      expect(e.patterns).toEqual(["um-aspect"]);
      expect(e.payload.answers).toEqual(kain.forms[e.payload.form]);
    }
    const types = new Set(exercises.filter((e) => e.patterns.length).map((e) => e.type));
    expect([...types].sort()).toEqual(["conjugate", "fill_blank", "paradigm", "transform"]);
    // Vocabulary drills come first: recognition before the grammar block, production after.
    expect(exercises.slice(0, 4).every((e) => e.patterns.length === 0)).toBe(true);
  });

  it("explains each wrong option of the grammar fill-in-the-blank", async () => {
    const { exercises } = await stub.generate(lessonWith([umAspect]), [kain]);
    const fill = exercises.find((e) => e.type === "fill_blank" && e.patterns.length);
    if (fill?.type !== "fill_blank") throw new Error("no grammar fill_blank");
    expect(fill.payload.why).toHaveLength(fill.payload.options.length);
    expect(fill.payload.options[fill.payload.answerIndex]).toBe("kumain");
    expect(fill.payload.why?.[fill.payload.answerIndex]).toBeNull();
  });

  it("builds transform tiles with other forms of the same verb as distractors", async () => {
    const { exercises } = await stub.generate(lessonWith([umAspect]), [kain]);
    const t = exercises.find((e) => e.type === "transform");
    if (t?.type !== "transform") throw new Error("no transform");
    expect(t.payload.mode).toBe("build");
    expect(t.payload.answers).toEqual([["kakain", "ako", "ng", "isda"]]);
    // Every other form of kain/um, each tile once; the accepted answer's own tile is excluded.
    expect(t.payload.distractors).toEqual(["kumain", "kumakain", "kakakain"]);
    expect(t.payload.distractors).not.toContain("kakain");
  });

  it("hides two distinct cells of the paradigm and keeps the tiles unambiguous", async () => {
    const { exercises } = await stub.generate(lessonWith([umAspect]), [kain]);
    const p = exercises.find((e) => e.type === "paradigm");
    if (p?.type !== "paradigm") throw new Error("no paradigm");
    const hidden = p.payload.cells.filter((c) => c.hidden);
    expect(hidden).toHaveLength(2);
    expect(new Set(hidden.map((c) => c.value)).size).toBe(2);
    for (const c of p.payload.cells) expect(c.value).toBe(kain.forms[c.form]![0]);
  });

  it("asks find-the-root questions for a roots pattern", async () => {
    const roots: CoursePattern = {
      ...umAspect,
      id: "find-the-root",
      drills: { frames: [], transforms: [], choices: [] },
    };
    const luto: VerbTableData = {
      root: "luto",
      affix: "um",
      en: "to cook",
      forms: conjugate({ ...kainEntry, root: "luto", glottal: true }, "um"),
    };
    const req = lessonWith([roots]);
    req.grammar.verbs.push({ ...kainEntry, root: "luto", glottal: true });
    const { exercises } = await stub.generate(req, [kain, luto]);
    const q = exercises.find((e) => e.type === "find_root");
    if (q?.type !== "find_root") throw new Error("no find_root");
    expect(q.patterns).toEqual(["find-the-root"]);
    expect(q.payload.mode).toBe("choice");
    expect(q.payload.options).toContain(q.payload.root);
    expect(kain.forms.incompleted.concat(luto.forms.incompleted)).toContain(q.payload.word);
    expect(q.payload.hint).not.toContain(q.payload.root);
  });

  it("builds no drills from a verb with no approved table, and says which words it could not vouch for", async () => {
    const { exercises, rejected } = await stub.generate(lessonWith([umAspect]), []);
    // No conjugate or paradigm is built, so nothing is rejected for them; the choice and the transform
    // contain inflected forms nobody has approved, so the vocabulary check holds them back.
    expect(exercises.filter((e) => e.patterns.length)).toEqual([]);
    expect(rejected.map((r) => r.reason)).toEqual([
      expect.stringMatching(/unknown word "kakain"/),
      expect.stringMatching(/unknown word "kumain"/),
    ]);
  });

  it("does not use tables of verbs the lesson has not been taught", async () => {
    const req = lessonWith([umAspect]);
    req.grammar.verbs = [];
    const drills = buildGrammarDrills(req, [kain], rand);
    expect(drills.drills.some((d) => d.type === "conjugate" || d.type === "paradigm")).toBe(false);
  });

  it("rejects a conjugate drill whose answer is not in an approved table", () => {
    const req = lessonWith([umAspect]);
    const { drills } = buildGrammarDrills(req, [kain], rand);
    const good = drills.find((d) => d.type === "conjugate")!;
    expect(checkDrill(good, req, [kain])).toBeNull();
    // The same drill checked against a table that spells the form differently.
    const corrupted: VerbTableData = {
      ...kain,
      forms: { ...kain.forms, completed: ["kinain"], incompleted: ["kinakain"] },
    };
    expect(checkDrill(good, req, [corrupted])).toMatch(/approved verb table/);
    expect(checkDrill(good, req, [])).toMatch(/approved verb table/);
  });

  it("rejects a find_root drill whose word is not a form of the root", () => {
    const req = lessonWith([umAspect]);
    const bad: TaggedExercise = {
      type: "find_root",
      payload: { word: "kumain", mode: "choice", options: ["kain", "basa"], root: "basa", hint: "Remove the affix." },
      patterns: ["um-aspect"],
    };
    expect(checkDrill(bad, req, [kain])).toMatch(/approved verb table/);
  });

  it("rejects a drill that is tagged with a pattern the lesson does not teach or use", () => {
    const req = lessonWith([umAspect]);
    const { drills } = buildGrammarDrills(req, [kain], rand);
    expect(checkDrill({ ...drills[0], patterns: ["mag-aspect"] }, req, [kain])).toMatch(/mag-aspect/);
    expect(checkDrill({ ...drills[0], patterns: [] }, req, [kain])).not.toBeNull();
  });

  it("rejects drills using unknown words, without blocking the others", async () => {
    const pattern: CoursePattern = {
      ...umAspect,
      drills: { ...umAspect.drills, frames: [frame("___ ako ng bulaklak.", "completed"), ...umAspect.drills.frames] },
    };
    const { exercises, rejected } = await stub.generate(lessonWith([pattern]), [kain]);
    expect(rejected).toHaveLength(1);
    expect(rejected[0].reason).toMatch(/unknown word "bulaklak"/);
    expect(exercises.filter((e) => e.type === "conjugate")).toHaveLength(2);
    expect(JSON.stringify(exercises)).not.toContain("bulaklak");
    expect(exercises.filter((e) => e.patterns.length === 0).length).toBeGreaterThanOrEqual(8);
  });

  it("rejects a find_root hint or transform instruction that gives the answer away", () => {
    const req = lessonWith([umAspect]);
    const hinted: TaggedExercise = {
      type: "find_root",
      payload: { word: "kumain", mode: "type", root: "kain", hint: "The root is kain." },
      patterns: ["um-aspect"],
    };
    expect(checkDrill(hinted, req, [kain])).toMatch(/hint/);
    const transform: TaggedExercise = {
      type: "transform",
      payload: {
        source: "Kumain ako ng isda.",
        sourceEn: "I ate fish.",
        instruction: "Write Kakain ako ng isda.",
        mode: "type",
        answers: [["Kakain", "ako", "ng", "isda"]],
        distractors: [],
      },
      patterns: ["um-aspect"],
    };
    expect(checkDrill(transform, req, [kain])).toMatch(/instruction/);
  });

  it(`never adds more than ${MAX_GRAMMAR_DRILLS} grammar drills, sharing them between patterns`, async () => {
    const many: CoursePattern = {
      ...umAspect,
      drills: {
        ...umAspect.drills,
        frames: (["completed", "incompleted", "contemplated", "recent", "infinitive"] as const).map((f) =>
          frame("___ ako ng isda.", f),
        ),
      },
    };
    const other: CoursePattern = { ...many, id: "um-again" };
    const { exercises } = await stub.generate(lessonWith([many, other]), [kain]);
    const tagged = exercises.filter((e) => e.patterns.length);
    expect(tagged).toHaveLength(MAX_GRAMMAR_DRILLS);
    expect(new Set(tagged.flatMap((e) => e.patterns))).toEqual(new Set(["um-aspect", "um-again"]));
  });

  it("practises a pattern the lesson only uses with a single drill", async () => {
    const { exercises } = await stub.generate(lessonWith([], [umAspect]), [kain]);
    const tagged = exercises.filter((e) => e.patterns.length);
    expect(tagged).toHaveLength(1);
    expect(tagged[0].patterns).toEqual(["um-aspect"]);
  });

  it("leaves lessons without teaches/uses unchanged, whatever tables are passed", async () => {
    for (const req of allRequests) {
      const plain = await stub.generate(req);
      expect(
        plain.exercises.every((e) => e.patterns.length === 0),
        req.lesson.title,
      ).toBe(true);
      expect(await stub.generate(req, [kain]), req.lesson.title).toEqual(plain);
    }
  });

  it("is deterministic for grammar lessons too", async () => {
    const req = lessonWith([umAspect]);
    expect(await stub.generate(req, [kain])).toEqual(await stub.generate(req, [kain]));
  });
});

/** Fake Anthropic client that returns a canned tool_use block. */
function fakeClient(input: unknown): MessagesClient & { calls: unknown[] } {
  const calls: unknown[] = [];
  return {
    calls,
    messages: {
      create: async (params: unknown) => {
        calls.push(params);
        return { content: [{ type: "tool_use", name: "submit_exercises", input }] };
      },
    },
  };
}

describe("ClaudeGenerator", () => {
  const req = allRequests[0];

  it("sends the word list and forces the structured tool", async () => {
    const client = fakeClient({ exercises: [] });
    await new ClaudeGenerator({ client, model: "claude-sonnet-5-5" }).generate(req);
    const params = client.calls[0] as { model: string; tool_choice: { name: string }; messages: { content: string }[] };
    expect(params.model).toBe("claude-sonnet-5-5");
    expect(params.tool_choice.name).toBe("submit_exercises");
    expect(params.messages[0].content).toContain("kumusta");
  });

  it("keeps valid exercises and reports invalid ones instead of failing the batch", async () => {
    const client = fakeClient({
      exercises: [
        {
          type: "select_translation",
          payload: { prompt: "salamat", promptLang: "tl", options: ["thank you", "goodbye", "yes"], answerIndex: 0 },
        },
        { type: "select_translation", payload: { prompt: "oo", promptLang: "tl", options: ["yes"], answerIndex: 4 } },
        { type: "dance", payload: {} },
      ],
    });
    const out = await new ClaudeGenerator({ client, model: "m" }).generate(req);
    expect(out.exercises).toHaveLength(1);
    expect(out.rejected).toHaveLength(2);
  });

  it("throws a clear error when the model does not call the tool", async () => {
    const client: MessagesClient = {
      messages: { create: async () => ({ content: [{ type: "text", text: "Sorry" }] }) },
    };
    await expect(new ClaudeGenerator({ client, model: "m" }).generate(req)).rejects.toThrow(/tool/);
  });
});

describe("selectGenerator", () => {
  it("uses the stub when no API key is configured", () => {
    expect(selectGenerator({}).provider).toBe("stub");
  });

  it("uses Claude when an API key is present", () => {
    expect(selectGenerator({ ANTHROPIC_API_KEY: "sk-test" }).provider).toBe("claude");
  });

  it("honours an explicit CONTENT_GENERATOR=stub even with a key", () => {
    expect(selectGenerator({ ANTHROPIC_API_KEY: "sk-test", CONTENT_GENERATOR: "stub" }).provider).toBe("stub");
  });

  it("refuses CONTENT_GENERATOR=claude without a key", () => {
    expect(() => selectGenerator({ CONTENT_GENERATOR: "claude" })).toThrow(/ANTHROPIC_API_KEY/);
  });
});
