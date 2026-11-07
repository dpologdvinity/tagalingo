import { describe, expect, it } from "vitest";
import { xpForLesson } from "./xp";

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
