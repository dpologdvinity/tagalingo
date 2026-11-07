import { describe, expect, it } from "vitest";
import { addDays, applyLessonToStreak, dayKey, visibleStreak } from "./streak";

describe("dayKey", () => {
  it("uses the user's timezone to decide the calendar day", () => {
    const instant = new Date("2026-11-07T20:30:00Z");
    expect(dayKey(instant, "UTC")).toBe("2026-11-07");
    expect(dayKey(instant, "Asia/Manila")).toBe("2026-11-08"); // UTC+8
    expect(dayKey(instant, "America/Los_Angeles")).toBe("2026-11-07");
  });

  it("falls back to UTC for an invalid timezone", () => {
    expect(dayKey(new Date("2026-11-07T23:00:00Z"), "Not/AZone")).toBe("2026-11-07");
  });
});

describe("addDays", () => {
  it("moves across month boundaries", () => {
    expect(addDays("2026-10-31", 1)).toBe("2026-11-01");
    expect(addDays("2026-03-01", -1)).toBe("2026-02-28");
  });
});

describe("applyLessonToStreak", () => {
  it("starts a streak at 1", () => {
    expect(applyLessonToStreak({ currentStreak: 0, longestStreak: 0, lastStreakDay: null }, "2026-11-07")).toEqual({
      currentStreak: 1,
      longestStreak: 1,
      lastStreakDay: "2026-11-07",
      extended: true,
    });
  });

  it("does not double count a second lesson on the same day", () => {
    const s = applyLessonToStreak({ currentStreak: 4, longestStreak: 9, lastStreakDay: "2026-11-07" }, "2026-11-07");
    expect(s).toMatchObject({ currentStreak: 4, extended: false });
  });

  it("extends on consecutive days and tracks the longest", () => {
    const s = applyLessonToStreak({ currentStreak: 9, longestStreak: 9, lastStreakDay: "2026-11-06" }, "2026-11-07");
    expect(s).toMatchObject({ currentStreak: 10, longestStreak: 10, extended: true });
  });

  it("resets after a missed day", () => {
    const s = applyLessonToStreak({ currentStreak: 12, longestStreak: 30, lastStreakDay: "2026-11-04" }, "2026-11-07");
    expect(s).toMatchObject({ currentStreak: 1, longestStreak: 30, extended: true });
  });
});

describe("visibleStreak", () => {
  it("is still alive if the last lesson was yesterday", () => {
    expect(visibleStreak({ currentStreak: 5, lastStreakDay: "2026-11-06" }, "2026-11-07")).toBe(5);
  });

  it("shows zero once a full day has been missed", () => {
    expect(visibleStreak({ currentStreak: 5, lastStreakDay: "2026-11-05" }, "2026-11-07")).toBe(0);
  });
});
