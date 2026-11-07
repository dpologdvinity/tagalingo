/**
 * Hearts: a learner has up to MAX_HEARTS; each wrong answer costs one and one heart refills
 * every `refillMs`. Instead of a background job we store `(hearts, heartsUpdatedAt)` and
 * compute the live value on read. `heartsUpdatedAt` is the anchor of the refill clock.
 */
export const MAX_HEARTS = 5;

export type HeartState = { hearts: number; heartsUpdatedAt: Date };
export type LiveHearts = HeartState & { nextHeartAt: Date | null };

/** Resolve stored hearts into the value at `now`, advancing the anchor by whole intervals. */
export function liveHearts(state: HeartState, now: Date, refillMs: number): LiveHearts {
  if (state.hearts >= MAX_HEARTS) {
    return { hearts: MAX_HEARTS, heartsUpdatedAt: now, nextHeartAt: null };
  }
  const elapsed = Math.max(0, now.getTime() - state.heartsUpdatedAt.getTime());
  const gained = Math.floor(elapsed / refillMs);
  const hearts = Math.min(MAX_HEARTS, state.hearts + gained);
  if (hearts >= MAX_HEARTS) {
    return { hearts: MAX_HEARTS, heartsUpdatedAt: now, nextHeartAt: null };
  }
  const anchor = new Date(state.heartsUpdatedAt.getTime() + gained * refillMs);
  return { hearts, heartsUpdatedAt: anchor, nextHeartAt: new Date(anchor.getTime() + refillMs) };
}

/** Spend one heart at `now`. Losing from full starts the refill clock at `now`. */
export function loseHeart(state: HeartState, now: Date, refillMs: number): HeartState {
  const live = liveHearts(state, now, refillMs);
  return { hearts: Math.max(0, live.hearts - 1), heartsUpdatedAt: live.heartsUpdatedAt };
}
