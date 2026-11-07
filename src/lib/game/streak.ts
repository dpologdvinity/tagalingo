/**
 * Streaks are counted in calendar days of the learner's own timezone. Days are represented as
 * "YYYY-MM-DD" strings so they compare and store trivially and never drift with DST.
 */

export type StreakState = { currentStreak: number; longestStreak: number; lastStreakDay: string | null };

/** Calendar day of `instant` in `timeZone` (falls back to UTC for unknown zones). */
export function dayKey(instant: Date, timeZone: string): string {
  let fmt: Intl.DateTimeFormat;
  try {
    fmt = new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" });
  } catch {
    fmt = new Intl.DateTimeFormat("en-CA", { timeZone: "UTC", year: "numeric", month: "2-digit", day: "2-digit" });
  }
  // en-CA formats as YYYY-MM-DD.
  return fmt.format(instant);
}

/** Shift a YYYY-MM-DD day by `n` days. */
export function addDays(day: string, n: number): string {
  const d = new Date(`${day}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

/** New streak state after completing a lesson on `today`. */
export function applyLessonToStreak(state: StreakState, today: string): StreakState & { extended: boolean } {
  if (state.lastStreakDay === today) return { ...state, extended: false };
  const continues = state.lastStreakDay === addDays(today, -1);
  const currentStreak = continues ? state.currentStreak + 1 : 1;
  return {
    currentStreak,
    longestStreak: Math.max(state.longestStreak, currentStreak),
    lastStreakDay: today,
    extended: true,
  };
}

/** Streak to display: a streak survives until the end of the day after the last lesson. */
export function visibleStreak(state: Pick<StreakState, "currentStreak" | "lastStreakDay">, today: string): number {
  if (!state.lastStreakDay) return 0;
  return state.lastStreakDay === today || state.lastStreakDay === addDays(today, -1) ? state.currentStreak : 0;
}
