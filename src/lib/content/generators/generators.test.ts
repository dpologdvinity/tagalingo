import { describe, expect, it } from "vitest";
import path from "node:path";
import { loadCourseFile, lessonRequest } from "../course";
import { lintExercise, parseExercise } from "../schema";
import { StubGenerator } from "./stub";
import { ClaudeGenerator, type MessagesClient } from "./claude";
import { selectGenerator } from "./index";

const course = loadCourseFile(path.join(process.cwd(), "content/tagalog/course.yaml"));
const allRequests = course.units.flatMap((u) => u.skills.flatMap((s) => s.lessons.map((_, i) => lessonRequest(s, i))));

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

  it("adds a picture exercise when a lesson word has a picture", async () => {
    for (const req of allRequests) {
      if (!req.words.some((w) => w.pic)) continue;
      const pics = (await stub.generate(req)).exercises.filter((e) => e.type === "select_picture");
      expect(pics.length, req.lesson.title).toBe(1);
      const [ex] = pics;
      if (ex.type !== "select_picture") continue;
      expect(new Set(ex.payload.pictures).size).toBe(ex.payload.pictures.length);
      const answerWord = req.allWords.find((w) => w.tl === ex.payload.prompt)!;
      expect(ex.payload.pictures[ex.payload.answerIndex]).toBe(answerWord.pic);
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
