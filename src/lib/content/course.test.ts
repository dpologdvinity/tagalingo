import { describe, expect, it } from "vitest";
import path from "node:path";
import { loadCourseFile, parseCourse } from "./course";

const minimal = {
  course: { slug: "tl-en", title: "T", fromLang: "en", toLang: "tl" },
  units: [
    {
      slug: "u1",
      title: "U1",
      subtitle: "s",
      color: "#13A3A9",
      skills: [
        {
          slug: "s1",
          title: "S1",
          emoji: "👋",
          description: "d",
          lessons: [{ title: "L1", words: ["salamat"] }],
          words: [
            { tl: "salamat", en: "thank you", pos: "phrase", ex: ["Salamat po.", "Thank you."] },
            { tl: "oo", en: "yes", pos: "particle", ex: ["Oo, salamat.", "Yes, thanks."] },
            { tl: "hindi", en: "no", pos: "particle", ex: ["Hindi po.", "No, sir."] },
            { tl: "paalam", en: "goodbye", pos: "phrase", ex: ["Paalam, Ana.", "Goodbye, Ana."] },
          ],
        },
      ],
    },
  ],
};

describe("parseCourse", () => {
  it("parses a minimal course and defaults optional word fields", () => {
    const course = parseCourse(minimal);
    const word = course.units[0].skills[0].words[0];
    expect(word).toMatchObject({ tl: "salamat", accept: [], exAccept: [] });
  });

  it("rejects a lesson that references a word missing from the skill", () => {
    const bad = structuredClone(minimal);
    bad.units[0].skills[0].lessons[0].words = ["bundok"];
    expect(() => parseCourse(bad)).toThrow(/bundok/);
  });

  it("rejects an example sentence that does not contain its word", () => {
    const bad = structuredClone(minimal);
    bad.units[0].skills[0].words[0].ex = ["Bundok po.", "Mountain."];
    expect(() => parseCourse(bad)).toThrow(/example/i);
  });
});

describe("the shipped Tagalog course", () => {
  it("loads and validates", () => {
    const course = loadCourseFile(path.join(process.cwd(), "content/tagalog/course.yaml"));
    expect(course.units.length).toBeGreaterThanOrEqual(3);
    for (const unit of course.units) for (const skill of unit.skills) expect(skill.lessons.length).toBeGreaterThan(0);
  });
});
