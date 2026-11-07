"use server";
/** Chat with Tala: one reply per call. The conversation lives in the browser; nothing is stored. */
import { prepareChatHistory } from "@/lib/chat/history";
import { selectChatTutor, type ChatReply } from "@/lib/chat/tutor";
import { chatLimiter } from "@/server/rate-limit";
import { getCurrentUser } from "@/server/session";

export type ChatResult = { ok: true; reply: ChatReply } | { ok: false; message: string };

export async function chatAction(history: unknown): Promise<ChatResult> {
  const user = await getCurrentUser();
  if (!user) return { ok: false, message: "Your session has ended. Log in again to keep chatting." };
  const prepared = prepareChatHistory(history);
  if (!prepared.ok) return prepared;
  if (!chatLimiter.take(user.id)) return { ok: false, message: "Tala needs a short break. Try again in a minute." };
  try {
    return { ok: true, reply: await selectChatTutor().reply({ history: prepared.history, learnerName: user.name }) };
  } catch (e) {
    console.error(e);
    return { ok: false, message: "Tala couldn't answer just now. Try again in a moment." };
  }
}
