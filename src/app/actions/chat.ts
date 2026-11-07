"use server";
/** Chat with Tala: one reply per call. The conversation lives in the browser; nothing is stored. */
import { z } from "zod";
import { selectChatTutor, type ChatReply } from "@/lib/chat/tutor";
import { getCurrentUser } from "@/server/session";

const historySchema = z
  .array(z.object({ role: z.enum(["learner", "tala"]), text: z.string().trim().min(1).max(200) }))
  .min(1)
  .max(24);

export type ChatResult = { ok: true; reply: ChatReply } | { ok: false; message: string };

export async function chatAction(history: unknown): Promise<ChatResult> {
  const user = await getCurrentUser();
  if (!user) return { ok: false, message: "Your session has ended. Log in again to keep chatting." };
  const parsed = historySchema.safeParse(history);
  if (!parsed.success) return { ok: false, message: "Messages must be 1–200 characters." };
  try {
    // Only the most recent turns matter for a beginner chat, and they keep requests small.
    const reply = await selectChatTutor().reply({ history: parsed.data.slice(-12), learnerName: user.name });
    return { ok: true, reply };
  } catch (e) {
    console.error(e);
    return { ok: false, message: "Tala couldn't answer just now. Try again in a moment." };
  }
}
