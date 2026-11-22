/**
 * Tests for the player's keyboard guards. They run in Node, so the DOM is stood in for by minimal
 * objects with the one method the guards use (`closest`) or by a fake document.
 */
import { describe, expect, it } from "vitest";
import { chipOwnsEnter, dialogOpen, isControl } from "./keys";

/** A stand-in element whose `closest` matches a selector list when it names one of `matches`. */
const element = (...matches: string[]) => ({
  closest: (selector: string) => (selector.split(",").some((part) => matches.includes(part.trim())) ? {} : null),
});

describe("chipOwnsEnter", () => {
  it("is true inside the grammar help chip, whose button must activate on Enter", () => {
    expect(chipOwnsEnter(element("[data-chip]"))).toBe(true);
  });

  it("is false for answer controls, the page, a heading or a text field", () => {
    // After a mouse click focus sits on the option or tile, and Enter must still check the answer.
    expect(chipOwnsEnter(element("button"))).toBe(false);
    expect(chipOwnsEnter(element("a[href]"))).toBe(false);
    expect(chipOwnsEnter(element())).toBe(false);
    expect(chipOwnsEnter(null)).toBe(false);
    expect(chipOwnsEnter({})).toBe(false);
  });
});

describe("isControl", () => {
  it("is true for a button or a link, which activate on Enter themselves", () => {
    expect(isControl(element("button"))).toBe(true);
    expect(isControl(element("a[href]"))).toBe(true);
  });

  it("is false for the page, a heading or a text field", () => {
    expect(isControl(element())).toBe(false);
    expect(isControl(null)).toBe(false);
    expect(isControl({})).toBe(false);
  });
});

describe("dialogOpen", () => {
  it("is true while a modal dialog is open", () => {
    expect(dialogOpen({ querySelector: (s: string) => (s === "dialog[open]" ? {} : null) })).toBe(true);
    expect(dialogOpen({ querySelector: () => null })).toBe(false);
  });
});
