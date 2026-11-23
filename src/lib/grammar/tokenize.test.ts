import { describe, expect, it } from "vitest";
import { lookupFor, tokenize, wordKeys } from "./tokenize";

describe("tokenize", () => {
  it("splits words from punctuation and spacing and loses nothing", () => {
    const text = "Ikinagagalak kitang makilala, Marco! Taga-saan ka?";
    const tokens = tokenize(text);
    expect(tokens.map((t) => t.text).join("")).toBe(text);
    expect(tokens.filter((t) => t.word).map((t) => t.text)).toEqual([
      "Ikinagagalak",
      "kitang",
      "makilala",
      "Marco",
      "Taga-saan",
      "ka",
    ]);
  });

  it("keeps hyphens and apostrophes inside a word but not around it", () => {
    expect(
      tokenize("mag-aral - ma’am 'ako'")
        .filter((t) => t.word)
        .map((t) => t.text),
    ).toEqual(["mag-aral", "ma’am", "ako"]);
  });

  it("handles accents and text without words", () => {
    expect(tokenize("pô").map((t) => [t.text, t.word])).toEqual([["pô", true]]);
    expect(tokenize("?! …")).toEqual([{ text: "?! …", word: false }]);
    expect(tokenize("")).toEqual([]);
  });
});

describe("wordKeys", () => {
  it("lists each normalised word once, in order of first appearance", () => {
    expect(wordKeys(tokenize("Kumain ako. kumain AKO, mag-aral!"))).toEqual(["kumain", "ako", "magaral"]);
  });
});

describe("lookupFor", () => {
  it("finds a word by its normalised form", () => {
    expect(lookupFor({ kumain: [1] }, "Kumain")).toEqual([1]);
    expect(lookupFor({ kumain: [1] }, "ako")).toBeUndefined();
  });

  it("ignores names every object inherits", () => {
    expect(lookupFor({}, "constructor")).toBeUndefined();
    expect(lookupFor({}, "toString")).toBeUndefined();
    expect(lookupFor({}, "__proto__")).toBeUndefined();
  });
});
