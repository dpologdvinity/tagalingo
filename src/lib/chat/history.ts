/**
 * Chat history limits, shared by the chat page (what it sends) and the server action (what it
 * accepts), so a long conversation or a long reply from Tala can never lock the chat.
 */
import { z } from "zod";
import type { ChatTurn } from "./tutor";

export const CHAT_LIMITS = {
  /** Longest message a learner can send. */
  learnerChars: 200,
  /** Longest reply Tala sends (tutors cap their replies at this). */
  talaChars: 400,
  /** Turns of context sent to the tutor; older turns are dropped. */
  contextTurns: 12,
  /** Hard cap on what the server will even parse. */
  maxTurns: 200,
} as const;

const turnSchema = z.discriminatedUnion("role", [
  z.object({ role: z.literal("learner"), text: z.string().trim().min(1) }),
  z.object({ role: z.literal("tala"), text: z.string().trim().min(1).max(CHAT_LIMITS.talaChars) }),
]);

export type PreparedHistory = { ok: true; history: ChatTurn[] } | { ok: false; message: string };

/** Validate and trim a conversation to the most recent `contextTurns` turns. */
export function prepareChatHistory(raw: unknown): PreparedHistory {
  const parsed = z.array(turnSchema).min(1).max(CHAT_LIMITS.maxTurns).safeParse(raw);
  if (!parsed.success) return { ok: false, message: "That conversation couldn't be read. Refresh to start again." };
  const history = parsed.data.slice(-CHAT_LIMITS.contextTurns);
  const last = history[history.length - 1];
  if (last.role !== "learner") return { ok: false, message: "Send a message for Tala to answer." };
  if (history.some((t) => t.role === "learner" && t.text.length > CHAT_LIMITS.learnerChars)) {
    return { ok: false, message: `Keep messages under ${CHAT_LIMITS.learnerChars} characters.` };
  }
  return { ok: true, history };
}
