/**
 * Consistency check between verb drills and the approved verb tables.
 *
 * conjugate, paradigm and find_root drills copy their answers from a table when they are
 * generated, and nothing re-checks them when a reviewer later corrects or rejects that table.
 * `verbDrillIssues` re-runs the check against the tables as they are now, so the Studio can warn
 * and CI can fail when shipped drills and `verbs.json` drift apart. Pure: pass the approved
 * tables (`loadApprovedVerbs`, or `loadApprovedVerbTables` for the database).
 */
import type { ParsedExercise } from "@/lib/content/schema";
import { normalizeAnswer } from "@/lib/normalize";
import { analyse, type VerbTableData } from "./analyse";
import type { Affix, VerbForm } from "./types";

const tableOf = (tables: readonly VerbTableData[], root: string, affix: Affix) =>
  tables.find((t) => t.root === root && t.affix === affix);

/** The table cell a drill reads (`[]` when the table has no such cell, e.g. `recent`). */
const cellOf = (table: VerbTableData, form: VerbForm): string[] => table.forms[form] ?? [];

/**
 * Human-readable problems with a verb drill, or `[]` when it agrees with the approved `tables`
 * (or is not a verb drill). Flags a missing table (none approved for the root/affix), a conjugate
 * answer outside the table's `form` cell, a paradigm cell that differs from the canonical spelling,
 * and a find_root word that is not a form of any approved table for `root`.
 */
export function verbDrillIssues(ex: ParsedExercise, tables: readonly VerbTableData[]): string[] {
  switch (ex.type) {
    case "conjugate": {
      const { root, affix, form, answers } = ex.payload;
      const table = tableOf(tables, root, affix);
      if (!table) return [`No approved table for ${root} (${affix}); this drill's answers can't be checked.`];
      const cell = cellOf(table, form).map(normalizeAnswer);
      return answers
        .filter((a) => !cell.includes(normalizeAnswer(a)))
        .map((a) => `Answer "${a}" is not in the approved ${form} form of ${root} (${affix}).`);
    }
    case "paradigm": {
      const { root, affix, cells } = ex.payload;
      const table = tableOf(tables, root, affix);
      if (!table) return [`No approved table for ${root} (${affix}); this drill's cells can't be checked.`];
      return cells
        .filter((c) => normalizeAnswer(c.value) !== normalizeAnswer(cellOf(table, c.form)[0] ?? ""))
        .map((c) => `Cell "${c.value}" differs from the approved ${c.form} form of ${root} (${affix}).`);
    }
    case "find_root": {
      const { word, root } = ex.payload;
      const own = tables.filter((t) => t.root === root);
      if (!own.length) return [`No approved table for ${root}; this drill's word can't be checked.`];
      return analyse(word, own).length ? [] : [`"${word}" is not a form of ${root} in any approved table.`];
    }
    default:
      return [];
  }
}
