import { describe, expect, it } from "vitest";
import { MAX_HEARTS, liveHearts, loseHeart } from "./hearts";

const MIN = 60_000;
const refillMs = 30 * MIN;
const t0 = new Date("2026-11-07T10:00:00Z");
const at = (minutes: number) => new Date(t0.getTime() + minutes * MIN);

describe("liveHearts", () => {
  it("returns full hearts with no refill timer when already at max", () => {
    const s = liveHearts({ hearts: MAX_HEARTS, heartsUpdatedAt: t0 }, at(90), refillMs);
    expect(s).toEqual({ hearts: MAX_HEARTS, heartsUpdatedAt: at(90), nextHeartAt: null });
  });

  it("refills one heart per interval and keeps the partial progress", () => {
    const s = liveHearts({ hearts: 2, heartsUpdatedAt: t0 }, at(75), refillMs);
    expect(s.hearts).toBe(4);
    // Two full intervals consumed; the 15 minutes of progress toward the next heart are kept.
    expect(s.heartsUpdatedAt).toEqual(at(60));
    expect(s.nextHeartAt).toEqual(at(90));
  });

  it("caps at the maximum", () => {
    expect(liveHearts({ hearts: 0, heartsUpdatedAt: t0 }, at(600), refillMs).hearts).toBe(MAX_HEARTS);
  });
});

describe("loseHeart", () => {
  it("starts the refill clock when losing a heart from full", () => {
    const s = loseHeart({ hearts: MAX_HEARTS, heartsUpdatedAt: t0 }, at(500), refillMs);
    expect(s.hearts).toBe(MAX_HEARTS - 1);
    expect(s.heartsUpdatedAt).toEqual(at(500));
  });

  it("keeps the running refill clock when already below max", () => {
    const s = loseHeart({ hearts: 3, heartsUpdatedAt: t0 }, at(10), refillMs);
    expect(s.hearts).toBe(2);
    expect(s.heartsUpdatedAt).toEqual(t0);
  });

  it("never goes below zero", () => {
    expect(loseHeart({ hearts: 0, heartsUpdatedAt: t0 }, at(1), refillMs).hearts).toBe(0);
  });
});
