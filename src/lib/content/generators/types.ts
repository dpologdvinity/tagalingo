/**
 * The content-generator interface. Anything that can turn a lesson's word list into draft
 * exercises implements this; the app never talks to a paid API directly.
 */
import type { GenerationRequest } from "../course";
import type { ParsedExercise } from "../schema";

export type GeneratorProvider = "claude" | "stub";

export type GenerationResult = {
  /** Valid exercises, in suggested lesson order. They are saved as DRAFT for human review. */
  exercises: ParsedExercise[];
  /** Items the generator returned that failed validation, kept for diagnostics. */
  rejected: { raw: unknown; reason: string }[];
};

export interface ExerciseGenerator {
  readonly provider: GeneratorProvider;
  readonly model: string;
  generate(request: GenerationRequest): Promise<GenerationResult>;
}
