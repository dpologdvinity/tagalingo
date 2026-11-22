import { describe, expect, it } from "vitest";
import { addDays, applyLessonToStreak, dayKey, dayKeyDaysAgo, visibleStreak } from "./streak";

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

describe("dayKeyDaysAgo", () => {
  it("is today's key at zero days ago", () => {
    const now = new Date("2026-11-07T20:30:00Z");
    expect(dayKeyDaysAgo(now, 0, "Asia/Manila")).toBe("2026-11-08");
  });

  it("steps back by calendar days when the clocks go back, even late in the evening", () => {
    // 23:30 EST on Nov 14, 2026: DST ended Nov 1, a 25-hour day, so 13 and 14 "24-hour days" ago
    // both fall on Nov 1 local time.
    const now = new Date("2026-11-15T04:30:00Z");
    expect(dayKey(now, "America/New_York")).toBe("2026-11-14");
    const keys = Array.from({ length: 21 }, (_, daysAgo) => dayKeyDaysAgo(now, daysAgo, "America/New_York"));
    expect(new Set(keys).size).toBe(keys.length);
    keys.forEach((key, daysAgo) => expect(key).toBe(addDays("2026-11-14", -daysAgo)));
  });

  it("steps back by calendar days when the clocks go forward", () => {
    // 00:30 EDT on Mar 20, 2026: DST began Mar 8, a 23-hour day.
    const now = new Date("2026-03-20T04:30:00Z");
    const keys = Array.from({ length: 21 }, (_, daysAgo) => dayKeyDaysAgo(now, daysAgo, "America/New_York"));
    expect(new Set(keys).size).toBe(keys.length);
    keys.forEach((key, daysAgo) => expect(key).toBe(addDays("2026-03-20", -daysAgo)));
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
