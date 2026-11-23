/**
 * Word analysis and review diffing for the grammar engine.
 *
 * `analyse` answers "which verb forms could this typed word be?" against a set of reviewed tables;
 * `diffFromRule` answers "which cells did a reviewer change from the engine's draft?". Both are
 * pure and work on plain data, so they run on the server and in tests alike.
 */
import { normalizeAnswer } from "@/lib/normalize";
import { conjugate } from "./morphology";
import { VERB_FORMS, type Affix, type FormTable, type VerbEntry, type VerbForm } from "./types";

/** One reviewed verb table as the analyser sees it. */
export type VerbTableData = { root: string; affix: Affix; en: string; forms: FormTable };

/** One reading of a word: the table and cell it matched, plus that cell's canonical spelling. */
export type Analysis = { root: string; affix: Affix; en: string; form: VerbForm; canonical: string };

/** The cell's forms, or [] for an absent optional cell (`recent` exists only for um/mag/ma). */
function cellOf(forms: FormTable, form: VerbForm): string[] {
  return forms[form] ?? [];
}

/**
 * Every (table, form) cell whose canonical form or accepted variant equals the word after
 * `normalizeAnswer` (so case, accents and hyphens don't matter). A word can match several cells,
 * e.g. kumain is both the infinitive and the completed form of kain/um; all readings are returned
 * in table order, then form order.
 */
export function analyse(word: string, tables: readonly VerbTableData[]): Analysis[] {
  const target = normalizeAnswer(word);
  if (target === "") return [];
  const found: Analysis[] = [];
  for (const { root, affix, en, forms } of tables) {
    for (const form of VERB_FORMS) {
      const cell = cellOf(forms, form);
      if (cell.some((spelling) => normalizeAnswer(spelling) === target)) {
        found.push({ root, affix, en, form, canonical: cell[0] });
      }
    }
  }
  return found;
}

/**
 * Forms whose reviewed cell differs from what `conjugate` drafts for the same verb and affix,
 * i.e. the cells a reviewer corrected. Cells are compared exactly, including variant order, and a
 * missing cell counts as empty.
 */
export function diffFromRule(verb: VerbEntry, affix: Affix, reviewed: FormTable): VerbForm[] {
  const draft = conjugate(verb, affix);
  return VERB_FORMS.filter((form) => {
    const a = cellOf(draft, form);
    const b = cellOf(reviewed, form);
    return a.length !== b.length || a.some((spelling, i) => spelling !== b[i]);
  });
}
