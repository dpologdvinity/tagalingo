/**
 * Tests for `verbDrillIssues`: whether a conjugate, paradigm or find_root drill still agrees with
 * the approved verb tables. Tables are built with `conjugate` so the tests track the engine.
 */
import { describe, expect, it } from "vitest";
import { parseExercise } from "@/lib/content/schema";
import type { VerbTableData } from "./analyse";
import { verbDrillIssues } from "./drill-check";
import { conjugate } from "./morphology";
import type { VerbEntry } from "./types";

const kain: VerbEntry = { root: "kain", en: "eat", affixes: ["um"], glottal: false, stem: null, forms: {} };
const tables: VerbTableData[] = [{ root: "kain", affix: "um", en: "eat", forms: conjugate(kain, "um") }];

const conjugateDrill = (answers: string[], form = "completed", affix = "um") =>
  parseExercise("conjugate", {
    sentence: "___ ako kahapon.",
    translation: "I ate yesterday.",
    root: "kain",
    affix,
    form,
    answers,
  });

const findRootDrill = (word: string, root = "kain") =>
  parseExercise("find_root", { word, mode: "type", root, hint: "Look past the infix." });

const paradigmDrill = (completed: string) =>
  parseExercise("paradigm", {
    root: "kain",
    affix: "um",
    en: "eat",
    cells: [
      { form: "infinitive", value: "kumain", hidden: false },
      { form: "completed", value: completed, hidden: true },
    ],
    distractors: ["kakain"],
  });

describe("verbDrillIssues", () => {
  it("accepts drills that match the table", () => {
    expect(verbDrillIssues(conjugateDrill(["kumain"]), tables)).toEqual([]);
    expect(verbDrillIssues(conjugateDrill(["kakain"], "contemplated"), tables)).toEqual([]);
    expect(verbDrillIssues(findRootDrill("kumakain"), tables)).toEqual([]);
    expect(verbDrillIssues(paradigmDrill("kumain"), tables)).toEqual([]);
  });

  it("ignores other exercise types", () => {
    const ex = parseExercise("transform", {
      source: "Kumain ako.",
      sourceEn: "I ate.",
      instruction: "Make it future.",
      mode: "type",
      answers: [["Kakain", "ako."]],
    });
    expect(verbDrillIssues(ex, [])).toEqual([]);
  });

  it("flags a conjugate answer that is not in the table's form cell", () => {
    const issues = verbDrillIssues(conjugateDrill(["kumakain"]), tables);
    expect(issues.join(" ")).toMatch(/kumakain.*completed/);
  });

  it("flags a paradigm cell that differs from the table", () => {
    expect(verbDrillIssues(paradigmDrill("kinain"), tables).join(" ")).toMatch(/kinain.*completed/);
  });

  it("flags a find_root word that is not a form of the root", () => {
    expect(verbDrillIssues(findRootDrill("kumakain", "luto"), tables).join(" ")).toMatch(/luto/);
    expect(verbDrillIssues(findRootDrill("bumili"), tables).join(" ")).toMatch(/bumili/);
  });

  it("flags a missing table, or a table that is not approved", () => {
    expect(verbDrillIssues(conjugateDrill(["kumain"]), []).join(" ")).toMatch(/no approved table.*kain.*um/i);
    expect(verbDrillIssues(conjugateDrill(["kumain"], "completed", "mag"), tables).join(" ")).toMatch(/no approved/i);
    expect(verbDrillIssues(findRootDrill("kumain"), []).join(" ")).toMatch(/no approved table/i);
  });
});
