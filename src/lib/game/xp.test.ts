import { describe, expect, it } from "vitest";
import { xpForLesson, xpForPractice } from "./xp";

describe("xpForLesson", () => {
  it("awards base + perfect + first-time bonuses", () => {
    expect(xpForLesson({ mistakes: 0, firstCompletion: true })).toEqual({
      total: 20,
      breakdown: [
        { label: "Lesson complete", amount: 10 },
        { label: "Perfect lesson", amount: 5 },
        { label: "First time", amount: 5 },
      ],
    });
  });

  it("awards only the base for a replay with mistakes", () => {
    expect(xpForLesson({ mistakes: 3, firstCompletion: false }).total).toBe(10);
  });
});

describe("xpForPractice", () => {
  it("awards 5 XP, plus 5 for a perfect run", () => {
    expect(xpForPractice({ mistakes: 0 }).total).toBe(10);
    expect(xpForPractice({ mistakes: 2 })).toEqual({ total: 5, breakdown: [{ label: "Practice complete", amount: 5 }] });
  });
});
