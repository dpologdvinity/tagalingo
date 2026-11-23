import { describe, expect, it } from "vitest";
import { addDays, applyLessonToStreak, dayKey, dayKeyDaysAgo, instantOnDayAgo, visibleStreak } from "./streak";

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

describe("instantOnDayAgo", () => {
  const DAY = 86_400_000;

  it("goes back by the requested minutes when that stays on the day", () => {
    const now = new Date("2026-11-20T06:00:00Z"); // 14:00 in Manila
    const at = instantOnDayAgo(now, 3, "Asia/Manila", 90);
    expect(at.getTime()).toBe(now.getTime() - 3 * DAY - 90 * 60_000);
    expect(dayKey(at, "Asia/Manila")).toBe("2026-11-17");
  });

  it("falls back to the day's own instant when the minutes cross midnight", () => {
    // 08:00 in Manila: ten hours earlier on that day is 22:00 the evening before, and an hour either way
    // is still the wrong day. A minute before the same time of day is the right one.
    const now = new Date("2026-11-20T00:00:00Z");
    const at = instantOnDayAgo(now, 3, "Asia/Manila", 600);
    expect(dayKey(at, "Asia/Manila")).toBe(dayKeyDaysAgo(now, 3, "Asia/Manila"));
    expect(at.getTime()).toBe(now.getTime() - 3 * DAY - 60_000);
  });

  it("lands on every calendar day across a DST change, never in the future", () => {
    const now = new Date("2026-11-15T04:30:00Z"); // 23:30 EST; the clocks went back on Nov 1
    for (let daysAgo = 0; daysAgo <= 21; daysAgo++) {
      for (const minutes of [1, 300, 600]) {
        const at = instantOnDayAgo(now, daysAgo, "America/New_York", minutes);
        expect(dayKey(at, "America/New_York")).toBe(dayKeyDaysAgo(now, daysAgo, "America/New_York"));
        expect(at <= now).toBe(true);
      }
    }
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
