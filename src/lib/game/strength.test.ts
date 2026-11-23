import { describe, expect, it } from "vitest";
import { STRENGTH, effectiveStrength, strengthLabel, updateStrength } from "./strength";

const DAY = 86_400_000;
const now = new Date("2026-11-11T12:00:00Z");
const daysAgo = (days: number) => new Date(now.getTime() - days * DAY);

describe("updateStrength", () => {
  it("moves toward 1 on a correct answer", () => {
    let s = 0;
    for (let i = 0; i < 6; i++) s = updateStrength(s, true);
    expect(s).toBeCloseTo(0.882, 3);
    expect(strengthLabel(s, 6)).toBe("solid");
  });

  it("moves toward 0 on a wrong answer", () => {
    // 0.7 * 0.882353 = 0.617647, so compare to 0.6176 at three decimals.
    expect(updateStrength(0.882, false)).toBeCloseTo(0.6176, 3);
  });

  it("uses the configured alpha", () => {
    expect(STRENGTH.alpha).toBe(0.3);
    expect(updateStrength(0.5, true)).toBeCloseTo(0.5 + 0.3 * 0.5, 10);
  });
});

describe("effectiveStrength", () => {
  it("halves over one half-life of 21 days", () => {
    expect(effectiveStrength(0.8, daysAgo(21), now)).toBeCloseTo(0.4, 10);
  });

  it("returns the stored strength when never practised", () => {
    expect(effectiveStrength(0.8, null, now)).toBe(0.8);
  });

  it("does not decay for a practice time in the future", () => {
    expect(effectiveStrength(0.8, new Date(now.getTime() + DAY), now)).toBe(0.8);
  });

  it("uses fractional days", () => {
    expect(effectiveStrength(1, daysAgo(10.5), now)).toBeCloseTo(Math.pow(0.5, 0.5), 10);
  });
});

describe("strengthLabel", () => {
  it("is new with zero attempts regardless of strength", () => {
    expect(strengthLabel(0, 0)).toBe("new");
    expect(strengthLabel(0.99, 0)).toBe("new");
  });

  it("is learning below 0.6", () => {
    expect(strengthLabel(0.59, 3)).toBe("learning");
  });

  it("is solid from 0.6 up to 0.9", () => {
    expect(strengthLabel(0.6, 3)).toBe("solid");
    expect(strengthLabel(0.89, 20)).toBe("solid");
  });

  it("is mastered at 0.9 or above only with at least 8 attempts", () => {
    expect(strengthLabel(0.9, 7)).toBe("solid");
    expect(strengthLabel(0.9, 8)).toBe("mastered");
  });
});
