import { describe, expect, it } from "vitest";
import { avatarColor, contrastRatio, hslToHex } from "./color";

describe("contrastRatio", () => {
  it("follows the WCAG formula", () => {
    expect(contrastRatio("#ffffff", "#000000")).toBeCloseTo(21, 5);
    expect(contrastRatio("#13a3a9", "#ffffff")).toBeCloseTo(3.07, 2);
    expect(contrastRatio("#ffffff", "#13a3a9")).toBe(contrastRatio("#13a3a9", "#ffffff"));
  });
});

describe("hslToHex", () => {
  it("converts CSS hsl() values", () => {
    expect(hslToHex(0, 100, 50)).toBe("#ff0000");
    expect(hslToHex(120, 100, 25)).toBe("#008000");
    expect(hslToHex(0, 0, 100)).toBe("#ffffff");
  });
});

describe("avatarColor", () => {
  it("gives white initials at least 4.5:1 contrast on every hue", () => {
    for (let hue = 0; hue < 360; hue++) {
      expect(contrastRatio(avatarColor(hue), "#ffffff"), `hue ${hue}`).toBeGreaterThanOrEqual(4.5);
    }
  });

  it("keeps the original 42% lightness where it already passes", () => {
    expect(avatarColor(230)).toBe(hslToHex(230, 55, 42));
  });

  it("wraps hues outside 0–359", () => {
    expect(avatarColor(-30)).toBe(avatarColor(330));
    expect(avatarColor(400)).toBe(avatarColor(40));
  });
});
