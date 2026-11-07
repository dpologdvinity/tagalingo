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

  it("produces a valid, mixed lesson of 8–12 exercises for every lesson in the course", async () => {
    for (const req of allRequests) {
      const { exercises } = await stub.generate(req);
      expect(exercises.length, req.lesson.title).toBeGreaterThanOrEqual(8);
      expect(exercises.length, req.lesson.title).toBeLessThanOrEqual(12);
      for (const ex of exercises) expect(() => parseExercise(ex.type, ex.payload)).not.toThrow();
      expect(new Set(exercises.map((e) => e.type)).size, req.lesson.title).toBeGreaterThanOrEqual(4);
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
        const proper = /^(I|I'm|I'll|Ana|Maria|Juan|Lola|Lolo|Nanay|Tatay|Ate|Kuya|Grandma|Grandpa|Mom|Dad|Lunes|Biyernes|Linggo|Monday|Friday|Sunday)$/;
        for (const t of [...ex.payload.answer, ...ex.payload.distractors]) {
          if (t[0] !== t[0].toLowerCase()) expect(t, JSON.stringify(ex.payload)).toMatch(proper);
        }
      }
    }
  });

  it("only uses fill-in-the-blank distractors with a different part of speech", async () => {
    const req = allRequests[0];
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
