import { describe, expect, it } from "vitest";
import { ClaudeTutor, selectChatTutor, StubTutor, type ChatTurn } from "./tutor";
import type { MessagesClient } from "@/lib/content/generators/claude";

const ask = (text: string, history: ChatTurn[] = []) =>
  new StubTutor().reply({ history: [...history, { role: "learner", text }], learnerName: "Sam" });

describe("StubTutor", () => {
  it("answers a greeting in Tagalog with a translation", async () => {
    const r = await ask("Kumusta ka?");
    expect(r.text).toMatch(/Mabuti/);
    expect(r.translation).toMatch(/fine/i);
  });

  it("picks up the learner's name from 'Ako si …'", async () => {
    expect((await ask("Ako si Marco.")).text).toContain("Marco");
  });

  it("responds to thanks and goodbyes", async () => {
    expect((await ask("Salamat po!")).text).toMatch(/Walang anuman/);
    expect((await ask("Paalam!")).text).toMatch(/Paalam/);
  });

  it("nudges learners who write in English to try Tagalog", async () => {
    const r = await ask("hello how are you doing today");
    expect(r.text).toMatch(/Tagalog/i);
    expect(r.hint).toBeTruthy();
  });

  it("never returns an empty reply for unexpected input", async () => {
    const r = await ask("asdfgh");
    expect(r.text.length).toBeGreaterThan(0);
    expect(r.translation.length).toBeGreaterThan(0);
  });
});

describe("ClaudeTutor", () => {
  it("returns the structured reply from the forced tool call", async () => {
    const calls: unknown[] = [];
    const client: MessagesClient = {
      messages: {
        create: async (params) => {
          calls.push(params);
          return {
            content: [
              {
                type: "tool_use",
                name: "reply",
                input: { text: "Mabuti naman!", translation: "I'm fine!", correction: "Say: Kumusta ka?" },
              },
            ],
          };
        },
      },
    };
    const r = await new ClaudeTutor({ client, model: "m" }).reply({
      history: [{ role: "learner", text: "Kumusta ikaw?" }],
      learnerName: "Sam",
    });
    expect(r).toEqual({ text: "Mabuti naman!", translation: "I'm fine!", correction: "Say: Kumusta ka?" });
    expect(JSON.stringify(calls[0])).toContain("Kumusta ikaw?");
  });
});

describe("selectChatTutor", () => {
  it("falls back to the stub without a key", () => {
    expect(selectChatTutor({}).name).toBe("stub");
  });
  it("uses Claude with a key unless CHAT_TUTOR=stub", () => {
    expect(selectChatTutor({ ANTHROPIC_API_KEY: "k" }).name).toBe("claude");
    expect(selectChatTutor({ ANTHROPIC_API_KEY: "k", CHAT_TUTOR: "stub" }).name).toBe("stub");
  });
});
