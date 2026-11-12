import { describe, expect, it } from "vitest";
import path from "node:path";
import { loadApprovedVerbs } from "../grammar/verbs-file";
import { grammarVocabIssues } from "../grammar/vocab-check";
import { knownWordsUpTo, loadCourseFile, lessonRequest, parseCourse } from "./course";

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

  it("shipped grammar content uses only known words", () => {
    const course = loadCourseFile(path.join(process.cwd(), "content/tagalog/course.yaml"));
    expect(grammarVocabIssues(course, loadApprovedVerbs())).toEqual([]);
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

describe("grammar in course.yaml", () => {
  type Skill = Record<string, unknown> & { lessons: Record<string, unknown>[]; words: Record<string, unknown>[] };
  const pat = (id: string, over: Record<string, unknown> = {}) => ({
    id,
    title: `Pattern ${id}`,
    rule: "A rule.",
    examples: [
      ["Salamat po.", "Thank you."],
      ["Oo, salamat.", "Yes, thanks."],
    ],
    ...over,
  });
  /** Two-lesson course (L1: salamat, L2: oo) with patterns a and b, taught by L1 and L2 respectively. */
  const withGrammar = () => {
    const c = structuredClone(minimal) as unknown as { grammar: unknown[]; units: { skills: Skill[] }[] };
    const skill = c.units[0].skills[0];
    skill.lessons = [
      { title: "L1", words: ["salamat"], teaches: ["a"] },
      { title: "L2", words: ["oo"], teaches: ["b"], uses: ["a"] },
    ];
    c.grammar = [pat("a"), pat("b", { requires: ["a"] })];
    return c;
  };
  const lesson = (c: ReturnType<typeof withGrammar>, i: number) => c.units[0].skills[0].lessons[i];

  it("parses patterns, teaches and uses, and defaults them to empty", () => {
    const course = parseCourse(withGrammar());
    expect(course.grammar.map((p) => p.id)).toEqual(["a", "b"]);
    expect(course.units[0].skills[0].lessons[1]).toMatchObject({ teaches: ["b"], uses: ["a"] });
    const plain = parseCourse(minimal);
    expect(plain.grammar).toEqual([]);
    expect(plain.units[0].skills[0]).toMatchObject({ verbs: [] });
    expect(plain.units[0].skills[0].lessons[0]).toMatchObject({ teaches: [], uses: [] });
  });

  it("rejects a pattern taught by two lessons", () => {
    const bad = withGrammar();
    lesson(bad, 1).teaches = ["a", "b"];
    expect(() => parseCourse(bad)).toThrow(/taught by more than one lesson/);
  });

  it("rejects a pattern no lesson teaches", () => {
    const bad = withGrammar();
    lesson(bad, 1).teaches = [];
    expect(() => parseCourse(bad)).toThrow(/not taught/);
  });

  it("rejects a duplicate pattern id", () => {
    const bad = withGrammar();
    bad.grammar.push(pat("a"));
    expect(() => parseCourse(bad)).toThrow(/duplicate/i);
  });

  it("rejects teaches/uses/requires of an unknown pattern", () => {
    for (const field of ["teaches", "uses"]) {
      const bad = withGrammar();
      lesson(bad, 1)[field] = [...(lesson(bad, 1)[field] as string[]), "nope"];
      expect(() => parseCourse(bad), field).toThrow(/unknown pattern/);
    }
    const bad = withGrammar();
    (bad.grammar[1] as { requires: string[] }).requires = ["nope"];
    expect(() => parseCourse(bad)).toThrow(/unknown pattern/);
  });

  it("rejects requires or uses pointing at a later pattern", () => {
    const badRequires = withGrammar();
    (badRequires.grammar[0] as { requires: string[] }).requires = ["b"];
    expect(() => parseCourse(badRequires)).toThrow(/later/);
    const badUses = withGrammar();
    lesson(badUses, 0).uses = ["b"];
    expect(() => parseCourse(badUses)).toThrow(/later/);
  });

  it("rejects a pattern whose own entry is invalid", () => {
    const bad = withGrammar();
    bad.grammar[0] = pat("a", { mistakes: [["Salamat po.", "That is right."]] });
    expect(() => parseCourse(bad)).toThrow(/mistake/);
  });

  it("rejects an invalid verb entry under a skill", () => {
    const bad = withGrammar();
    bad.units[0].skills[0].verbs = [{ root: "kain", en: "eat", affixes: ["zz"] }];
    expect(() => parseCourse(bad)).toThrow(/verbs/);
  });
});

describe("lessonRequest", () => {
  /** Skill s1 has lessons [salamat | oo] and a multi-word entry; skill s2 has lessons [kumusta po | magandang umaga | paalam]. */
  const fixture = () => {
    const c = structuredClone(minimal) as unknown as {
      grammar: unknown[];
      units: { skills: Record<string, unknown>[] }[];
    };
    const word = (tl: string, en: string) => ({ tl, en, pos: "phrase", ex: [`${tl}.`, `${en}.`] });
    const s1 = c.units[0].skills[0];
    s1.words = [
      word("Salamat", "thanks"),
      word("oo", "yes"),
      word("hindi", "no"),
      word("Ano ang pangalan mo?", "name?"),
    ];
    s1.lessons = [
      { title: "L1", words: ["Salamat", "oo"] },
      { title: "L2", words: ["hindi", "Ano ang pangalan mo?"] },
    ];
    s1.verbs = [{ root: "kain", en: "eat", affixes: ["um"] }];
    c.units[0].skills.push({
      slug: "s2",
      title: "S2",
      emoji: "x",
      description: "d",
      lessons: [
        { title: "M1", words: ["kumusta po"], teaches: ["a"] },
        { title: "M2", words: ["magandang umaga"], teaches: ["b"], uses: ["a"] },
        { title: "M3", words: ["paalam"] },
      ],
      words: [
        word("kumusta po", "hi"),
        word("magandang umaga", "good morning"),
        word("paalam", "bye"),
        word("sige", "ok"),
      ],
      verbs: [{ root: "inom", en: "drink", affixes: ["um"] }],
    });
    c.grammar = [
      {
        id: "a",
        title: "A",
        rule: "r",
        examples: [
          ["Kumusta po.", "Hi."],
          ["Kumusta po ako.", "Hi, me."],
        ],
      },
      {
        id: "b",
        title: "B",
        rule: "r",
        examples: [
          ["Magandang umaga.", "Good morning."],
          ["Magandang umaga po.", "Good morning, sir."],
        ],
        requires: ["a"],
      },
    ];
    return parseCourse(c);
  };

  it("exposes teaches, uses, cumulative verbs and known words", () => {
    const course = fixture();
    const [s1, s2] = course.units[0].skills;
    const req = lessonRequest(course, s2, 1);
    expect(req.grammar.teaches.map((p) => p.id)).toEqual(["b"]);
    expect(req.grammar.uses.map((p) => p.id)).toEqual(["a"]);
    expect(req.grammar.verbs.map((v) => v.root).sort()).toEqual(["inom", "kain"]);
    expect(req.grammar.verbTables).toEqual([]);
    // All of skill 1, lessons 1-2 of skill 2 (split and lower-cased), nothing from lesson 3.
    expect(new Set(req.grammar.knownWords)).toEqual(
      new Set(["salamat", "oo", "hindi", "ano", "ang", "pangalan", "mo", "kumusta", "po", "magandang", "umaga"]),
    );
    expect(req.grammar.knownWords).not.toContain("paalam");
    // Skill 1 only knows its own verb and nothing from skill 2.
    const first = lessonRequest(course, s1, 0);
    expect(first.grammar.verbs.map((v) => v.root)).toEqual(["kain"]);
    expect(first.grammar.knownWords).toEqual(["salamat", "oo"]);
    expect(first.grammar.teaches).toEqual([]);
  });

  it("builds known words from lesson words only, up to and including the given lesson", () => {
    const course = fixture();
    const [s1, s2] = course.units[0].skills;
    expect(knownWordsUpTo(course, "s1", 0)).toEqual(new Set(["salamat", "oo"]));
    const known = knownWordsUpTo(course, "s2", 1);
    expect(known).toEqual(
      new Set(["salamat", "oo", "hindi", "ano", "ang", "pangalan", "mo", "kumusta", "po", "magandang", "umaga"]),
    );
    // "sige" is in skill 2's word list but in no lesson, so it is not known yet.
    expect(s2.words.map((w) => w.tl)).toContain("sige");
    expect(known.has("sige")).toBe(false);
    expect(s1.words.map((w) => w.tl)).toContain("Salamat");
    expect(() => knownWordsUpTo(course, "nope", 0)).toThrow(/skill/i);
  });

  it("does not treat an earlier skill's unused word-list entry as known", () => {
    const c = fixture();
    const extra = {
      tl: "bahay",
      en: "house",
      pos: "noun" as const,
      accept: [],
      exAccept: [],
      ex: ["Bahay.", "House."] as [string, string],
    };
    c.units[0].skills[0].words.push(extra);
    expect(knownWordsUpTo(c, "s2", 0).has("bahay")).toBe(false);
    expect(lessonRequest(c, c.units[0].skills[1], 0).grammar.knownWords).not.toContain("bahay");
  });

  it("still describes the lesson as before", () => {
    const course = fixture();
    const req = lessonRequest(course, course.units[0].skills[1], 1);
    expect(req.lesson).toEqual({ title: "M2", index: 1 });
    expect(req.words.map((w) => w.tl)).toEqual(["magandang umaga"]);
    expect(req.reviewWords.map((w) => w.tl)).toEqual(["kumusta po"]);
  });

  it("throws for a lesson or skill that does not exist", () => {
    const course = fixture();
    expect(() => lessonRequest(course, course.units[0].skills[0], 9)).toThrow(/lesson/);
    expect(() => lessonRequest({ ...course, units: [] }, course.units[0].skills[0], 0)).toThrow(/skill/i);
  });
});
