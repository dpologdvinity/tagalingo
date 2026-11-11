import { describe, expect, it } from "vitest";
import { patternSchema, verbEntrySchema } from "./grammar-schema";

const pattern = {
  id: "um-aspect",
  title: "-um- verbs",
  rule: "Put -um- before the first vowel.",
  examples: [
    ["Kumain ako ng kanin.", "I ate rice."],
    ["Kakain ako ng kanin.", "I will eat rice."],
  ],
};

describe("patternSchema", () => {
  it("defaults the optional parts", () => {
    expect(patternSchema.parse(pattern)).toMatchObject({
      notes: [],
      mistakes: [],
      requires: [],
      drills: { frames: [], transforms: [], choices: [] },
    });
  });

  it("rejects a non-kebab-case id and a bad example count", () => {
    expect(() => patternSchema.parse({ ...pattern, id: "Um Aspect" })).toThrow();
    expect(() => patternSchema.parse({ ...pattern, examples: [pattern.examples[0]] })).toThrow();
  });

  it("rejects a table row whose width differs from the head", () => {
    expect(() => patternSchema.parse({ ...pattern, table: { head: ["a", "b"], rows: [["x"]] } })).toThrow(/table/);
  });

  it("rejects a mistake identical to an example sentence", () => {
    const bad = { ...pattern, mistakes: [["kumain ako ng kanin", "Already right."]] };
    expect(() => patternSchema.parse(bad)).toThrow(/mistake/);
  });

  it("rejects a mistake identical to a transform answer", () => {
    const bad = {
      ...pattern,
      mistakes: [["Kakain ako.", "Already right."]],
      drills: { transforms: [["Kumain ako.", "I ate.", "Make it future", ["Kakain ako."]]] },
    };
    expect(() => patternSchema.parse(bad)).toThrow(/mistake/);
  });

  it("rejects a frame without exactly one blank", () => {
    for (const sentence of ["Kumain ako.", "___ ___ ako."]) {
      const bad = { ...pattern, drills: { frames: [[sentence, "I ate.", "um", "completed"]] } };
      expect(() => patternSchema.parse(bad)).toThrow(/blank/);
    }
  });

  it("accepts a frame with and without a root, and rejects an unknown affix or form", () => {
    const frames = [
      ["___ ako ng kanin.", "I ate rice.", "um", "completed"],
      ["___ ako ng kanin.", "I ate rice.", "um", "completed", "kain"],
    ];
    expect(patternSchema.parse({ ...pattern, drills: { frames } }).drills.frames).toHaveLength(2);
    const badAffix = { ...pattern, drills: { frames: [["___ ako.", "I.", "zz", "completed"]] } };
    expect(() => patternSchema.parse(badAffix)).toThrow();
    const badForm = { ...pattern, drills: { frames: [["___ ako.", "I.", "um", "pluperfect"]] } };
    expect(() => patternSchema.parse(badForm)).toThrow();
  });

  it("rejects a transform with no answers", () => {
    const bad = { ...pattern, drills: { transforms: [["Kumain ako.", "I ate.", "Make it future", []]] } };
    expect(() => patternSchema.parse(bad)).toThrow();
  });

  describe("choices", () => {
    const choice = (over: Record<string, unknown> = {}) => ({
      ...pattern,
      drills: {
        choices: [
          [
            "Pupunta ako ___ palengke.",
            "I'll go to the market.",
            ["sa", "ng", "ang"],
            (over.answerIndex as number | undefined) ?? 0,
            over.why ?? [null, "ng marks the thing acted on.", "ang marks the topic."],
          ],
        ],
      },
    });

    it("accepts a well-formed choice", () => {
      expect(patternSchema.parse(choice()).drills.choices).toHaveLength(1);
    });

    it("rejects a choice whose why has text at the answer index", () => {
      expect(() => patternSchema.parse(choice({ why: ["sa is right.", "x", "y"] }))).toThrow(/why/);
    });

    it("rejects a choice with a missing explanation for a wrong option", () => {
      expect(() => patternSchema.parse(choice({ why: [null, null, "y"] }))).toThrow(/why/);
    });

    it("rejects a why of the wrong length and an out-of-range answer index", () => {
      expect(() => patternSchema.parse(choice({ why: [null, "x"] }))).toThrow(/why/);
      expect(() => patternSchema.parse(choice({ answerIndex: 3 }))).toThrow();
    });
  });
});

describe("verbEntrySchema", () => {
  const verb = { root: "kain", en: "eat", affixes: ["um", "in"] };

  it("defaults glottal, stem and forms", () => {
    expect(verbEntrySchema.parse(verb)).toEqual({ ...verb, glottal: false, stem: null, forms: {} });
  });

  it("accepts a hyphenated root and a stem, and rejects upper case or padded roots", () => {
    expect(verbEntrySchema.parse({ ...verb, root: "bili", stem: "bilh" }).stem).toBe("bilh");
    expect(verbEntrySchema.parse({ ...verb, root: "pa-bili" }).root).toBe("pa-bili");
    expect(() => verbEntrySchema.parse({ ...verb, root: "Kain" })).toThrow();
    expect(() => verbEntrySchema.parse({ ...verb, root: " kain" })).toThrow();
    expect(() => verbEntrySchema.parse({ ...verb, stem: "Bilh" })).toThrow();
  });

  it("rejects a verb affix outside AFFIXES", () => {
    expect(() => verbEntrySchema.parse({ ...verb, affixes: ["zz"] })).toThrow();
  });

  it("rejects an override naming an unknown affix or form", () => {
    expect(() => verbEntrySchema.parse({ ...verb, forms: { zz: { infinitive: ["x"] } } })).toThrow();
    expect(() => verbEntrySchema.parse({ ...verb, forms: { in: { pluperfect: ["x"] } } })).toThrow();
  });

  it("rejects an empty override array", () => {
    expect(() => verbEntrySchema.parse({ ...verb, forms: { in: { infinitive: [] } } })).toThrow();
  });

  it("accepts overrides with variants", () => {
    const forms = { in: { infinitive: ["kunin"], completed: ["kinuha", "kinuha rin"] } };
    expect(verbEntrySchema.parse({ ...verb, forms }).forms).toEqual(forms);
  });
});
