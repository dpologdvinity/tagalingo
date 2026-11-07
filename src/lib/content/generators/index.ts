/**
 * Picks the content generator from environment variables:
 *
 *   CONTENT_GENERATOR=stub    → always the offline StubGenerator
 *   CONTENT_GENERATOR=claude  → ClaudeGenerator (requires ANTHROPIC_API_KEY)
 *   unset                     → Claude if ANTHROPIC_API_KEY is set, otherwise the stub
 */
import Anthropic from "@anthropic-ai/sdk";
import { ClaudeGenerator, type MessagesClient } from "./claude";
import { StubGenerator } from "./stub";
import type { ExerciseGenerator } from "./types";

export type { ExerciseGenerator, GenerationResult } from "./types";

export const DEFAULT_CLAUDE_MODEL = "claude-sonnet-5-5";

type GeneratorEnv = Record<string, string | undefined>;

export function selectGenerator(env: GeneratorEnv = process.env): ExerciseGenerator {
  const choice = env.CONTENT_GENERATOR?.trim().toLowerCase() || (env.ANTHROPIC_API_KEY ? "claude" : "stub");
  if (choice === "stub") return new StubGenerator();
  if (choice !== "claude") throw new Error(`Unknown CONTENT_GENERATOR "${env.CONTENT_GENERATOR}" (use claude or stub)`);
  if (!env.ANTHROPIC_API_KEY) throw new Error("CONTENT_GENERATOR=claude requires ANTHROPIC_API_KEY");

  const anthropic = new Anthropic({ apiKey: env.ANTHROPIC_API_KEY });
  // Narrow the SDK to the interface the generator needs (keeps tests free of the SDK).
  const client: MessagesClient = {
    messages: {
      create: async (params) =>
        (await anthropic.messages.create(params)) as unknown as Awaited<
          ReturnType<MessagesClient["messages"]["create"]>
        >,
    },
  };
  return new ClaudeGenerator({ client, model: env.ANTHROPIC_MODEL?.trim() || DEFAULT_CLAUDE_MODEL });
}
