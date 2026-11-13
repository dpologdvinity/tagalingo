/**
 * The player's step queue: exercises with grammar cards interleaved, plus which "?" chips an
 * exercise shows. Pure so the ordering rules are unit-tested without rendering anything.
 *
 * Card steps are introductions: they never submit an answer and are never re-queued. A new card sits
 * right before the first exercise tagged with its pattern; once dismissed it is "shown" and its chip
 * becomes available on the exercises that follow.
 */
import type { ClientExercise } from "@/lib/content/client-view";
import type { LessonCard } from "@/server/grammar";

export type Step = { kind: "card"; card: LessonCard } | { kind: "exercise"; exercise: ClientExercise };

/** Exercise id → pattern slugs, as `StartedAttempt.exercisePatterns` sends it. */
export type ExercisePatterns = Record<string, string[]>;

/** Exercises in order, each `isNew` card inserted once before the first exercise tagged with it. */
export function buildSteps(
  exercises: readonly ClientExercise[],
  cards: readonly LessonCard[],
  exercisePatterns: ExercisePatterns,
): Step[] {
  const introduced = new Map(cards.filter((c) => c.isNew).map((c) => [c.slug, c]));
  const steps: Step[] = [];
  for (const exercise of exercises) {
    for (const slug of exercisePatterns[exercise.id] ?? []) {
      const card = introduced.get(slug);
      if (!card) continue;
      steps.push({ kind: "card", card });
      introduced.delete(slug);
    }
    steps.push({ kind: "exercise", exercise });
  }
  return steps;
}

/** Cards whose chips an exercise shows: its patterns, minus new cards not yet shown this session. */
export function chipCards(
  exerciseId: string,
  cards: readonly LessonCard[],
  exercisePatterns: ExercisePatterns,
  shown: ReadonlySet<string>,
): LessonCard[] {
  const bySlug = new Map(cards.map((c) => [c.slug, c]));
  return (exercisePatterns[exerciseId] ?? []).flatMap((slug) => {
    const card = bySlug.get(slug);
    return card && (!card.isNew || shown.has(slug)) ? [card] : [];
  });
}
