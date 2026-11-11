/**
 * ClaudeGenerator — drafts lesson exercises with the Anthropic Messages API.
 *
 * We force a single tool call (`submit_exercises`) whose input schema is derived from the zod
 * payload schemas, then re-validate every item with `parseExercise`. Invalid items are
 * reported in `rejected` rather than failing the batch. Everything produced is saved as a
 * DRAFT; nothing reaches learners until a human approves it in /studio.
 *
 * The client is injected (`MessagesClient`) so tests run without a network or API key.
 */
import { z } from "zod";
import type { CourseWord, GenerationRequest } from "../course";
import { EXERCISE_TYPES, parseExercise, payloadSchemas, type ExerciseType, type ParsedExercise } from "../schema";
import type { ExerciseGenerator, GenerationResult } from "./types";

export type ToolInputSchema = { type: "object"; [key: string]: unknown };

/** The subset of the Anthropic SDK we depend on. */
export interface MessagesClient {
  messages: {
    create(params: {
      model: string;
      max_tokens: number;
      system: string;
      tools: { name: string; description: string; input_schema: ToolInputSchema }[];
      tool_choice: { type: "tool"; name: string };
      messages: { role: "user"; content: string }[];
    }): Promise<{ content: ({ type: string } & Record<string, unknown>)[] }>;
  };
}

const TOOL_NAME = "submit_exercises";

export const SYSTEM_PROMPT = `You are an expert Tagalog (Filipino) teacher writing exercises for Tagalingo, a short-lesson app for adult English speakers who are beginners.

Write natural, everyday Manila Tagalog as a native speaker would say it today. Avoid deep or archaic words, and avoid Taglish unless the English loanword is the normal everyday word.

Rules:
- Teach the lesson's NEW words. You may reuse REVIEW words and very common function words (ang, ng, sa, si, ni, ay, ko, mo, ka, ba, na, po, naman, lang, at, may, wala). Do not introduce other vocabulary.
- Exactly one answer may be correct. Never offer a distractor that is also a valid translation (e.g. kami and tayo both mean "we"; siya is both "he" and "she").
- List every reasonable translation in "answers" / "alternates" so that learners giving a correct answer are not marked wrong. English answers should accept common contractions (I'm / I am).
- fill_blank sentences contain exactly one "___", and the wrong options should be clearly ungrammatical or wrong in context.
- word_bank "answer" is the sentence split into tiles without punctuation. "distractors" are 2–3 plausible tiles that are NOT part of any correct answer.
- match_pairs uses 4 pairs whose meanings do not overlap.
- listen_select: "audio" is a Tagalog word or short sentence that will be spoken aloud; the options are English meanings.
- speak: a short Tagalog sentence (8 words or fewer) for the learner to say aloud, with its English "translation".
- dialogue: if a DIALOGUE is given below, use its lines as context and its final line as the correct option. Use the listed wrong replies as the other options.
- Use "promptLang" to say which language the prompt is written in.
- Produce 10–13 exercises. Use every exercise type at least once, order them from easier (recognition) to harder (production), and make sure every new word appears at least once.`;

function describeWord(w: CourseWord): string {
  const extras = [
    w.accept.length ? `also: ${w.accept.join(", ")}` : null,
    w.note ? `note: ${w.note}` : null,
    `example: "${w.ex[0]}" = "${w.ex[1]}"`,
  ].filter(Boolean);
  return `- ${w.tl} (${w.pos}) = ${w.en}; ${extras.join("; ")}`;
}

export function buildUserPrompt(req: GenerationRequest): string {
  return [
    `Skill: ${req.skill.title} — ${req.skill.description}`,
    `Lesson ${req.lesson.index + 1}: ${req.lesson.title}`,
    "",
    "NEW words:",
    ...req.words.map(describeWord),
    "",
    req.reviewWords.length ? "REVIEW words:" : "REVIEW words: (none — this is the first lesson)",
    ...req.reviewWords.map(describeWord),
    "",
    ...req.dialogues.flatMap((d, i) => [
      "",
      `DIALOGUE ${i + 1}:`,
      ...d.lines.map(([speaker, tl, en]) => `${speaker}: ${tl} (${en})`),
      `Wrong replies: ${d.wrong.join(" | ")}`,
    ]),
    "",
    `Call ${TOOL_NAME} with the exercises.`,
  ].join("\n");
}

/** JSON schema for the tool input: an array of `{ type, payload }` discriminated by type. */
export function toolInputSchema(): ToolInputSchema {
  return {
    type: "object",
    properties: {
      exercises: {
        type: "array",
        items: {
          anyOf: EXERCISE_TYPES.map((t) => ({
            type: "object",
            properties: {
              type: { const: t },
              payload: z.toJSONSchema(payloadSchemas[t], { unrepresentable: "any" }),
            },
            required: ["type", "payload"],
          })),
        },
      },
    },
    required: ["exercises"],
  };
}

export class ClaudeGenerator implements ExerciseGenerator {
  readonly provider = "claude" as const;
  readonly model: string;
  private readonly client: MessagesClient;

  constructor(opts: { client: MessagesClient; model: string }) {
    this.client = opts.client;
    this.model = opts.model;
  }

  async generate(req: GenerationRequest): Promise<GenerationResult> {
    const response = await this.client.messages.create({
      model: this.model,
      max_tokens: 8000,
      system: SYSTEM_PROMPT,
      tools: [
        {
          name: TOOL_NAME,
          description: "Submit the drafted exercises for one lesson.",
          input_schema: toolInputSchema(),
        },
      ],
      tool_choice: { type: "tool", name: TOOL_NAME },
      messages: [{ role: "user", content: buildUserPrompt(req) }],
    });

    const call = response.content.find((b) => b.type === "tool_use" && b.name === TOOL_NAME);
    if (!call) throw new Error(`Claude did not call the ${TOOL_NAME} tool`);

    const input = call.input as { exercises?: unknown };
    const items = Array.isArray(input?.exercises) ? input.exercises : [];
    const exercises: ParsedExercise[] = [];
    const rejected: GenerationResult["rejected"] = [];
    for (const raw of items) {
      try {
        const item = raw as { type?: unknown; payload?: unknown };
        exercises.push(parseExercise(item.type as ExerciseType, item.payload));
      } catch (e) {
        rejected.push({ raw, reason: e instanceof Error ? e.message : String(e) });
      }
    }
    return { exercises, rejected };
  }
}
