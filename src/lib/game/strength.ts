/**
 * Pattern strength: how well a learner has internalised a grammar pattern.
 *
 * Strength `s` lives in [0, 1]. Each graded answer nudges it toward 1 (correct) or 0 (wrong)
 * by a fixed fraction `alpha` (an exponential moving average). Between practice sessions the
 * value decays with a half-life, so a pattern not seen for a while reads as weaker. Decay is
 * applied on read by `effectiveStrength`; the stored value is only changed by `updateStrength`.
 *
 * Everything here is pure: callers pass `now` explicitly so tests and server code agree.
 */

const MS_PER_DAY = 86_400_000;

/** Tuning constants: `alpha` is the update step, `halfLifeDays` the decay half-life. */
export const STRENGTH = { alpha: 0.3, halfLifeDays: 21 } as const;

/** Thresholds for the display label. Mastery additionally needs enough attempts. */
const LEARNING_BELOW = 0.6;
const MASTERED_AT = 0.9;
const MASTERY_MIN_ATTEMPTS = 8;

export type StrengthLabel = "new" | "learning" | "solid" | "mastered";

/** Move stored strength toward the outcome: r = 1 when correct, 0 when wrong. */
export function updateStrength(s: number, correct: boolean): number {
  const r = correct ? 1 : 0;
  return s + STRENGTH.alpha * (r - s);
}

/**
 * Strength at `now` after time-based decay: `s * 0.5^(days / halfLifeDays)`.
 * A null `lastPracticedAt` (never practised) returns `s` unchanged. A timestamp in the future
 * counts as zero elapsed days, so clock skew never inflates strength.
 */
export function effectiveStrength(s: number, lastPracticedAt: Date | null, now: Date): number {
  if (lastPracticedAt === null) return s;
  const days = Math.max(0, (now.getTime() - lastPracticedAt.getTime()) / MS_PER_DAY);
  return s * Math.pow(0.5, days / STRENGTH.halfLifeDays);
}

/**
 * Human-facing label for an (already decayed) strength and the number of attempts so far.
 * Zero attempts is always "new", because a strength value means nothing before any answer.
 */
export function strengthLabel(effective: number, attempts: number): StrengthLabel {
  if (attempts === 0) return "new";
  if (effective < LEARNING_BELOW) return "learning";
  if (effective < MASTERED_AT) return "solid";
  return attempts >= MASTERY_MIN_ATTEMPTS ? "mastered" : "solid";
}
