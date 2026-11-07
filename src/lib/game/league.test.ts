import { describe, expect, it } from "vitest";
import { weekStartUtc, nextWeekStartUtc } from "./league";

describe("weekStartUtc", () => {
  it("returns Monday 00:00 UTC for a mid-week instant", () => {
    // 2026-11-07 is a Saturday.
    expect(weekStartUtc(new Date("2026-11-07T15:00:00Z")).toISOString()).toBe("2026-11-02T00:00:00.000Z");
  });

  it("treats Monday midnight as the start of the new week", () => {
    expect(weekStartUtc(new Date("2026-11-09T00:00:00Z")).toISOString()).toBe("2026-11-09T00:00:00.000Z");
  });

  it("puts Sunday in the week that began the previous Monday", () => {
    expect(weekStartUtc(new Date("2026-11-08T23:59:59Z")).toISOString()).toBe("2026-11-02T00:00:00.000Z");
  });
});

describe("nextWeekStartUtc", () => {
  it("is seven days after the current week start", () => {
    expect(nextWeekStartUtc(new Date("2026-11-07T15:00:00Z")).toISOString()).toBe("2026-11-09T00:00:00.000Z");
  });
});
