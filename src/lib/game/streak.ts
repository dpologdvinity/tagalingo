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

/**
 * Calendar day `daysAgo` days before today's, in `timeZone`. Steps back by calendar days rather than
 * by 24-hour spans, which land on the same (or a skipped) local date around a DST change.
 */
export function dayKeyDaysAgo(now: Date, daysAgo: number, timeZone: string): string {
  return addDays(dayKey(now, timeZone), -daysAgo);
}

const HOUR_MS = 3_600_000;
const DAY_MS = 24 * HOUR_MS;

/**
 * An instant on the calendar day `daysAgo` days before today's in `timeZone`, preferably
 * `minutesEarlier` before the same time of day (for seed data that wants a spread of times). Going
 * back whole 24-hour spans can miss the day: a DST change shifts the clock by an hour, and a large
 * `minutesEarlier` crosses midnight. So it tries that instant and an hour either side, then one minute
 * before the same time of day (and an hour either side) so the instant is always on the intended day
 * for the seed's activity rows. Never later than `now`.
 */
export function instantOnDayAgo(now: Date, daysAgo: number, timeZone: string, minutesEarlier = 1): Date {
  const day = dayKeyDaysAgo(now, daysAgo, timeZone);
  const at = (minutes: number) => now.getTime() - daysAgo * DAY_MS - minutes * 60_000;
  const wanted = new Date(at(minutesEarlier));
  const candidates = [at(minutesEarlier), at(1)].flatMap((t) => [t, t + HOUR_MS, t - HOUR_MS]).map((t) => new Date(t));
  return candidates.find((c) => c <= now && dayKey(c, timeZone) === day) ?? wanted;
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
