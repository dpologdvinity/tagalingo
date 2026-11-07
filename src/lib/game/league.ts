/**
 * The weekly Barkada League runs Monday 00:00 UTC → next Monday 00:00 UTC for everyone, so all
 * learners compete in the same window regardless of timezone.
 */

/** Start of the league week containing `now`. */
export function weekStartUtc(now: Date): Date {
  const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  const daysSinceMonday = (d.getUTCDay() + 6) % 7; // getUTCDay: Sunday = 0
  d.setUTCDate(d.getUTCDate() - daysSinceMonday);
  return d;
}

/** When the current league week ends (and the leaderboard resets). */
export function nextWeekStartUtc(now: Date): Date {
  const d = weekStartUtc(now);
  d.setUTCDate(d.getUTCDate() + 7);
  return d;
}
