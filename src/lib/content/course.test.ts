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

describe("v1.1 course fields", () => {
  const withExtras = () => {
    const c = structuredClone(minimal) as unknown as {
      units: { skills: Record<string, unknown>[] }[];
    };
    const skill = c.units[0].skills[0] as Record<string, unknown> & { words: Record<string, unknown>[] };
    skill.words[0].pic = "🙏";
    skill.tips = ["Salamat is the everyday way to say thank you."];
    skill.dialogues = [
      {
        lesson: 1,
        lines: [
          ["A", "Salamat po.", "Thank you."],
          ["B", "Walang anuman.", "You're welcome."],
        ],
        wrong: ["Paalam.", "Oo."],
      },
    ];
    return c;
  };

  it("parses pictures, tips and dialogues", () => {
    const skill = parseCourse(withExtras()).units[0].skills[0];
    expect(skill.words[0].pic).toBe("🙏");
    expect(skill.tips).toHaveLength(1);
    expect(skill.dialogues[0]).toMatchObject({ lesson: 1, wrong: ["Paalam.", "Oo."] });
  });

  it("defaults tips and dialogues to empty", () => {
    expect(parseCourse(minimal).units[0].skills[0]).toMatchObject({ tips: [], dialogues: [] });
  });

  it("requires a dialogue to end with B's reply", () => {
    const bad = withExtras();
    (bad.units[0].skills[0].dialogues as { lines: string[][] }[])[0].lines.reverse();
    expect(() => parseCourse(bad)).toThrow(/B/);
  });

  it("rejects a dialogue pointing at a lesson that doesn't exist", () => {
    const bad = withExtras();
    (bad.units[0].skills[0].dialogues as { lesson: number }[])[0].lesson = 9;
    expect(() => parseCourse(bad)).toThrow(/lesson/);
  });

  it("rejects a dialogue whose wrong replies include the right one", () => {
    const bad = withExtras();
    (bad.units[0].skills[0].dialogues as { wrong: string[] }[])[0].wrong = ["Walang anuman.", "Oo."];
    expect(() => parseCourse(bad)).toThrow(/wrong/);
  });

  it("rejects the same picture on two words in a skill", () => {
    const bad = withExtras();
    (bad.units[0].skills[0].words as Record<string, unknown>[])[1].pic = "🙏";
    expect(() => parseCourse(bad)).toThrow(/picture/);
  });
});
