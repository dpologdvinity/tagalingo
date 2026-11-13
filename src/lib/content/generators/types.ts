/**
 * The content-generator interface. Anything that can turn a lesson's word list into draft
 * exercises implements this; the app never talks to a paid API directly.
 */
import type { VerbTableData } from "@/lib/grammar/analyse";
import type { GenerationRequest } from "../course";
import type { ParsedExercise } from "../schema";

export type GeneratorProvider = "claude" | "stub";

/** A validated exercise plus the slugs of the grammar patterns it drills (empty for vocabulary drills). */
export type TaggedExercise = ParsedExercise & { patterns: string[] };

export type GenerationResult = {
  /** Valid exercises, in suggested lesson order. They are saved as DRAFT for human review. */
  exercises: TaggedExercise[];
  /** Items the generator returned that failed validation, kept for diagnostics. */
  rejected: { raw: unknown; reason: string }[];
};

export interface ExerciseGenerator {
  readonly provider: GeneratorProvider;
  readonly model: string;
  /**
   * `tables` are the course's approved verb tables; generators that build grammar drills use them
   * as the only source of inflected forms, the others ignore them.
   */
  generate(request: GenerationRequest, tables?: readonly VerbTableData[]): Promise<GenerationResult>;
}
