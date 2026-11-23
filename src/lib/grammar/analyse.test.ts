/**
 * Tests for `analyse` (which verb forms a typed word could be) and `diffFromRule` (which cells of a
 * reviewed table a reviewer changed from the engine's draft). Tables are built with `conjugate`
 * so the tests track the engine rather than hard-coding its output.
 */
import { describe, expect, it } from "vitest";
import { analyse, diffFromRule, type VerbTableData } from "./analyse";
import { conjugate } from "./morphology";
import type { Affix, VerbEntry } from "./types";

/** Builds a verb entry with the defaults most roots share (no final glottal stop, no syncope). */
function verb(root: string, extra: Partial<VerbEntry> = {}): VerbEntry {
  return { root, en: root, affixes: [], glottal: false, stem: null, forms: {}, ...extra };
}

/** The engine's own draft table for a verb and affix, in the shape `analyse` consumes. */
function tableData(v: VerbEntry, affix: Affix): VerbTableData {
  return { root: v.root, affix, en: v.en, forms: conjugate(v, affix) };
}

const kain = verb("kain");
const luto = verb("luto", { glottal: true });
const kuha = verb("kuha");

const tables = [tableData(kain, "um"), tableData(kain, "maka"), tableData(luto, "makapag"), tableData(luto, "mag")];

describe("analyse", () => {
  it("returns every matching cell", () => {
    // kumain is both the infinitive and the completed form of kain/um.
    const kumain = analyse("kumain", tables);
    expect(kumain).toHaveLength(2);
    expect(kumain.map((a) => a.form)).toEqual(["infinitive", "completed"]);
    expect(kumain.every((a) => a.root === "kain" && a.affix === "um" && a.en === "kain")).toBe(true);
    expect(kumain.every((a) => a.canonical === "kumain")).toBe(true);

    const kumakain = analyse("Kumakain", tables);
    expect(kumakain).toHaveLength(1);
    expect(kumakain[0].form).toBe("incompleted");
  });

  it("is case, hyphen and accent insensitive", () => {
    expect(analyse("  KUMÁKAIN! ", tables).map((a) => a.form)).toEqual(["incompleted"]);
    expect(analyse("mag-luto", tables).map((a) => a.form)).toEqual(["infinitive"]);
  });

  it("matches a canonical-only form exactly once", () => {
    // nakakain is the maka- completed form only; it is not an incompleted variant.
    const found = analyse("nakakain", tables);
    expect(found).toHaveLength(1);
    expect(found[0]).toMatchObject({ root: "kain", affix: "maka", form: "completed", canonical: "nakakain" });
  });

  it("finds variants and reports the canonical form of their cell", () => {
    // nakakapagluto is a colloquial variant of the makapag- incompleted nakapagluluto.
    const found = analyse("nakakapagluto", tables);
    expect(found).toHaveLength(1);
    expect(found[0]).toMatchObject({ root: "luto", affix: "makapag", form: "incompleted", canonical: "nakapagluluto" });
  });

  it("returns [] for unknown words", () => {
    expect(analyse("salamat", tables)).toEqual([]);
    expect(analyse("", tables)).toEqual([]);
  });
});

describe("diffFromRule", () => {
  it("flags changed cells only", () => {
    const reviewed = conjugate(kuha, "in");
    expect(diffFromRule(kuha, "in", { ...reviewed, infinitive: ["kunin"] })).toEqual(["infinitive"]);
  });

  it("returns [] when the reviewed table equals the rule output", () => {
    expect(diffFromRule(kuha, "in", conjugate(kuha, "in"))).toEqual([]);
  });

  it("treats an added variant or a missing recent form as a change", () => {
    const rule = conjugate(kain, "um");
    expect(diffFromRule(kain, "um", { ...rule, completed: [...rule.completed, "kinain"] })).toEqual(["completed"]);
    expect(diffFromRule(kain, "um", { ...rule, recent: undefined })).toEqual(["recent"]);
  });
});
