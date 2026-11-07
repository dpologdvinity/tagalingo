/**
 * "Chat with Tala": a beginner conversation partner behind a small interface.
 *
 * ClaudeTutor (with ANTHROPIC_API_KEY) holds a real, simple Tagalog conversation and gently
 * corrects mistakes. StubTutor is an offline, rule-based partner covering the course's first
 * topics (greetings, names, where you're from, food, thanks, goodbyes), so the feature works
 * with no account. Every reply comes with an English translation.
 */
import Anthropic from "@anthropic-ai/sdk";
import type { MessagesClient } from "@/lib/content/generators/claude";
import { normalizeAnswer } from "@/lib/game/grading";

export type ChatTurn = { role: "learner" | "tala"; text: string };
export type ChatReply = {
  text: string;
  translation: string;
  /** Gentle fix for the learner's last message, if it had a mistake. */
  correction?: string;
  /** Suggested thing to try saying next. */
  hint?: string;
};
export type ChatInput = { history: ChatTurn[]; learnerName: string };

export interface ChatTutor {
  readonly name: "claude" | "stub";
  reply(input: ChatInput): Promise<ChatReply>;
}

/* ---------------- offline stub ---------------- */

const ENGLISH = new Set([
  "the",
  "how",
  "are",
  "you",
  "is",
  "what",
  "hello",
  "hi",
  "my",
  "name",
  "i",
  "am",
  "do",
  "doing",
  "today",
  "where",
  "from",
]);

type Rule = { test: (t: string, words: string[]) => boolean; reply: (t: string, name: string) => ChatReply };

const capitalise = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

const RULES: Rule[] = [
  {
    test: (t) => /\b(ako si|pangalan ko ay|ang pangalan ko ay)\b/.test(t),
    reply: (t) => {
      const m = /(?:ako si|pangalan ko ay)\s+([a-zÀ-ɏ-]+)/.exec(t);
      const who = m ? capitalise(m[1]) : "kaibigan";
      return {
        text: `Ikinagagalak kitang makilala, ${who}! Taga-saan ka?`,
        translation: `Nice to meet you, ${who}! Where are you from?`,
        hint: "Taga-Maynila ako.",
      };
    },
  },
  {
    test: (t) => /\btaga\s?\w+/.test(t) && !/\btaga saan\b/.test(t),
    reply: () => ({
      text: "Ang ganda! Ano ang trabaho mo?",
      translation: "How lovely! What's your job?",
      hint: "Estudyante ako.",
    }),
  },
  {
    test: (t) => /\b(estudyante|guro|trabaho ko)\b/.test(t),
    reply: () => ({
      text: "Magaling! Gutom ka na ba?",
      translation: "Great! Are you hungry yet?",
      hint: "Oo, gutom na ako.",
    }),
  },
  {
    test: (t) => /\b(gutom|kain|kanin|tinapay)\b/.test(t),
    reply: () => ({
      text: "Kain tayo! Gusto mo ba ng kanin o tinapay?",
      translation: "Let's eat! Would you like rice or bread?",
      hint: "Gusto ko ng kanin.",
    }),
  },
  {
    test: (t) => /\b(gusto ko)\b/.test(t),
    reply: () => ({
      text: "Sige! Masarap 'yan. Ano pa?",
      translation: "Sure! That's delicious. What else?",
      hint: "Salamat po!",
    }),
  },
  {
    test: (t) => /\b(salamat)\b/.test(t),
    reply: () => ({
      text: "Walang anuman! Masaya akong tumulong.",
      translation: "You're welcome! I'm happy to help.",
      hint: "Paalam!",
    }),
  },
  {
    test: (t) => /\b(paalam|ingat|bye)\b/.test(t),
    reply: (_t, name) => ({
      text: `Paalam, ${name}! Ingat ka. Kita tayo bukas!`,
      translation: `Goodbye, ${name}! Take care. See you tomorrow!`,
    }),
  },
  {
    test: (t) => /\b(mabuti|ayos|okay)\b/.test(t),
    reply: () => ({
      text: "Mabuti naman! Ano ang pangalan mo?",
      translation: "Good to hear! What's your name?",
      hint: "Ako si …",
    }),
  },
  {
    test: (t) => /\b(kumusta|kamusta|magandang (umaga|hapon|gabi))\b/.test(t),
    reply: () => ({
      text: "Mabuti naman, salamat! Ikaw, kumusta ka?",
      translation: "I'm fine, thanks! And you, how are you?",
      hint: "Mabuti naman.",
    }),
  },
];

export class StubTutor implements ChatTutor {
  readonly name = "stub" as const;

  async reply({ history, learnerName }: ChatInput): Promise<ChatReply> {
    const last = [...history].reverse().find((t) => t.role === "learner")?.text ?? "";
    const t = normalizeAnswer(last);
    const words = t.split(" ").filter(Boolean);
    const rule = RULES.find((r) => r.test(t, words));
    if (rule) return rule.reply(t, learnerName);
    const english = words.filter((w) => ENGLISH.has(w)).length;
    if (english >= 2) {
      return {
        text: "Subukan natin sa Tagalog! Halimbawa: Kumusta ka?",
        translation: "Let's try it in Tagalog! For example: How are you?",
        hint: "Kumusta ka?",
      };
    }
    return {
      text: "Pasensya na, hindi ko naintindihan. Subukan mo ulit?",
      translation: "Sorry, I didn't understand. Try again?",
      hint: "Kumusta ka?",
    };
  }
}

/* ---------------- Claude ---------------- */

const TOOL = "reply";

export const TUTOR_SYSTEM_PROMPT = `You are Tala, a friendly tarsier who chats with adult beginners learning Tagalog (Filipino) in the Tagalingo app.

- Reply in simple, natural, everyday Tagalog: one or two short sentences, beginner vocabulary (greetings, people, family, food, numbers, places, time, travel, home).
- Keep the conversation going with a simple question.
- Always give an English translation of your reply.
- If the learner's last message had a Tagalog mistake, add a short, kind correction showing the natural way to say it. Otherwise leave "correction" out.
- If they write in English, answer briefly in Tagalog and encourage them to try in Tagalog, with a "hint" they could type.
- Never use offensive content; stay on language practice.`;

export class ClaudeTutor implements ChatTutor {
  readonly name = "claude" as const;
  constructor(private readonly opts: { client: MessagesClient; model: string }) {}

  async reply({ history, learnerName }: ChatInput): Promise<ChatReply> {
    const transcript = history.map((t) => `${t.role === "learner" ? learnerName : "Tala"}: ${t.text}`).join("\n");
    const res = await this.opts.client.messages.create({
      model: this.opts.model,
      max_tokens: 600,
      system: TUTOR_SYSTEM_PROMPT,
      tools: [
        {
          name: TOOL,
          description: "Send Tala's reply.",
          input_schema: {
            type: "object",
            properties: {
              text: { type: "string", description: "Tala's reply in Tagalog" },
              translation: { type: "string", description: "English translation" },
              correction: { type: "string", description: "Optional gentle correction of the learner's last message" },
              hint: { type: "string", description: "Optional Tagalog sentence the learner could say next" },
            },
            required: ["text", "translation"],
          },
        },
      ],
      tool_choice: { type: "tool", name: TOOL },
      messages: [{ role: "user", content: `Conversation so far:\n${transcript}\n\nReply as Tala.` }],
    });
    const call = res.content.find((b) => b.type === "tool_use" && b.name === TOOL);
    const input = (call?.input ?? {}) as Partial<ChatReply>;
    if (typeof input.text !== "string" || typeof input.translation !== "string")
      throw new Error("Tala's reply was malformed");
    return {
      text: input.text.slice(0, 400),
      translation: input.translation.slice(0, 400),
      ...(input.correction ? { correction: String(input.correction).slice(0, 300) } : {}),
      ...(input.hint ? { hint: String(input.hint).slice(0, 120) } : {}),
    };
  }
}

export function selectChatTutor(env: Record<string, string | undefined> = process.env): ChatTutor {
  const choice = env.CHAT_TUTOR?.trim().toLowerCase() || (env.ANTHROPIC_API_KEY ? "claude" : "stub");
  if (choice !== "claude" || !env.ANTHROPIC_API_KEY) return new StubTutor();
  const anthropic = new Anthropic({ apiKey: env.ANTHROPIC_API_KEY, timeout: 30_000, maxRetries: 1 });
  const client: MessagesClient = {
    messages: {
      create: async (params) =>
        (await anthropic.messages.create(params)) as unknown as Awaited<
          ReturnType<MessagesClient["messages"]["create"]>
        >,
    },
  };
  return new ClaudeTutor({ client, model: env.ANTHROPIC_MODEL?.trim() || "claude-sonnet-5-5" });
}
