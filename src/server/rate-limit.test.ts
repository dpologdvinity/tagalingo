import { describe, expect, it } from "vitest";
import { RateLimiter } from "./rate-limit";

describe("RateLimiter", () => {
  it("allows a burst up to capacity, then refuses", () => {
    const now = 0;
    const rl = new RateLimiter({ capacity: 3, refillPerMinute: 60 }, () => now);
    expect([rl.take("u"), rl.take("u"), rl.take("u"), rl.take("u")]).toEqual([true, true, true, false]);
  });

  it("refills over time and keys are independent", () => {
    let now = 0;
    const rl = new RateLimiter({ capacity: 1, refillPerMinute: 60 }, () => now);
    expect(rl.take("a")).toBe(true);
    expect(rl.take("a")).toBe(false);
    expect(rl.take("b")).toBe(true);
    now += 1000; // one token per second
    expect(rl.take("a")).toBe(true);
  });

  it("never stores more than capacity", () => {
    let now = 0;
    const rl = new RateLimiter({ capacity: 2, refillPerMinute: 60 }, () => now);
    rl.take("u");
    now += 10 * 60_000;
    expect([rl.take("u"), rl.take("u"), rl.take("u")]).toEqual([true, true, false]);
  });
});
