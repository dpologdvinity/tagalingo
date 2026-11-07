/** XP awarded for finishing a lesson, with a breakdown for the results screen. */

export const XP_RULES = { base: 10, perfect: 5, firstTime: 5 } as const;

export type XpAward = { total: number; breakdown: { label: string; amount: number }[] };

export function xpForLesson(input: { mistakes: number; firstCompletion: boolean }): XpAward {
  const breakdown: XpAward["breakdown"] = [{ label: "Lesson complete", amount: XP_RULES.base }];
  if (input.mistakes === 0) breakdown.push({ label: "Perfect lesson", amount: XP_RULES.perfect });
  if (input.firstCompletion) breakdown.push({ label: "First time", amount: XP_RULES.firstTime });
  return { total: breakdown.reduce((sum, b) => sum + b.amount, 0), breakdown };
}

export const PRACTICE_XP = { base: 5, perfect: 5 } as const;

/** XP for a practice session (reviewing finished skills). Practice also restores one heart. */
export function xpForPractice(input: { mistakes: number }): XpAward {
  const breakdown: XpAward["breakdown"] = [{ label: "Practice complete", amount: PRACTICE_XP.base }];
  if (input.mistakes === 0) breakdown.push({ label: "Perfect practice", amount: PRACTICE_XP.perfect });
  return { total: breakdown.reduce((sum, b) => sum + b.amount, 0), breakdown };
}
