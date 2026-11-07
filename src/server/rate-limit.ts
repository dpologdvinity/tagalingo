/**
 * Per-key token-bucket rate limiter guarding paid endpoints (Claude chat, Google TTS).
 *
 * In-memory, so limits are per server instance. That's enough to stop a single client running
 * up a bill; a multi-instance deployment that needs exact global limits should swap this for a
 * shared store (e.g. Redis/Upstash) behind the same `take()` call.
 */

export type RateLimitConfig = { capacity: number; refillPerMinute: number };

export class RateLimiter {
  private readonly buckets = new Map<string, { tokens: number; at: number }>();

  constructor(
    private readonly config: RateLimitConfig,
    private readonly now: () => number = Date.now,
  ) {}

  /** Spend one token for `key`; false when the bucket is empty. */
  take(key: string): boolean {
    const t = this.now();
    const b = this.buckets.get(key) ?? { tokens: this.config.capacity, at: t };
    const refilled = Math.min(this.config.capacity, b.tokens + ((t - b.at) / 60_000) * this.config.refillPerMinute);
    const ok = refilled >= 1;
    this.buckets.set(key, { tokens: ok ? refilled - 1 : refilled, at: t });
    if (this.buckets.size > 10_000) this.buckets.delete(this.buckets.keys().next().value!);
    return ok;
  }
}

/** Chat: a burst of 20 messages, then 10 a minute. */
export const chatLimiter = new RateLimiter({ capacity: 20, refillPerMinute: 10 });
/** TTS: a burst of 60 clips, then 30 a minute (cached clips don't count). */
export const ttsLimiter = new RateLimiter({ capacity: 60, refillPerMinute: 30 });
