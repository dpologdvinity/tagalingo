import { describe, expect, it } from "vitest";
import { CHAT_LIMITS, prepareChatHistory } from "./history";

const turn = (role: "learner" | "tala", text: string) => ({ role, text });

describe("prepareChatHistory", () => {
  it("keeps only the most recent turns, so long chats keep working", () => {
    const long = Array.from({ length: 60 }, (_, i) => turn(i % 2 ? "learner" : "tala", `line ${i}`));
    const r = prepareChatHistory(long);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.history).toHaveLength(CHAT_LIMITS.contextTurns);
      expect(r.history.at(-1)?.text).toBe("line 59");
    }
  });

  it("accepts Tala replies up to her own (longer) limit", () => {
    const r = prepareChatHistory([turn("tala", "x".repeat(CHAT_LIMITS.talaChars)), turn("learner", "Oo")]);
    expect(r.ok).toBe(true);
  });

  it("rejects an over-long learner message with a specific message", () => {
    const r = prepareChatHistory([turn("learner", "x".repeat(CHAT_LIMITS.learnerChars + 1))]);
    expect(r).toEqual({ ok: false, message: `Keep messages under ${CHAT_LIMITS.learnerChars} characters.` });
  });

  it("requires the last turn to be the learner's", () => {
    expect(prepareChatHistory([turn("tala", "Kumusta!")]).ok).toBe(false);
  });

  it("rejects malformed input", () => {
    expect(prepareChatHistory("nope").ok).toBe(false);
    expect(prepareChatHistory([{ role: "admin", text: "x" }]).ok).toBe(false);
  });
});
