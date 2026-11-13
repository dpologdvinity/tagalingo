/**
 * Text <-> verb-table cells for the Studio's editable tables. A reviewer edits each form as one line
 * of text where a comma separates the spellings: the first is canonical, the rest accepted variants
 * ("nakapagluluto, nakakapagluto"). These pure helpers convert both ways; the server validates the
 * result with `verbFileEntrySchema`, so nothing here judges whether a spelling is acceptable.
 */
import { VERB_FORMS, type VerbForm } from "./types";

/** "kumain, kakain" -> ["kumain", "kakain"]: trimmed, with empty entries dropped. */
export function parseCell(text: string): string[] {
  return text
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}

/** The inverse of `parseCell`; an absent cell is an empty line. */
export function formatCell(cell: readonly string[] | undefined): string {
  return (cell ?? []).join(", ");
}

/**
 * The forms object a table's inputs describe. An empty `recent` input means "this table has no
 * recently-completed form" and is left out; any other empty input stays `[]` so the server's
 * validation names the missing form instead of the editor silently dropping it.
 */
export function buildForms(inputs: Record<VerbForm, string>): Partial<Record<VerbForm, string[]>> {
  const forms: Partial<Record<VerbForm, string[]>> = {};
  for (const form of VERB_FORMS) {
    const cell = parseCell(inputs[form]);
    if (form !== "recent" || cell.length) forms[form] = cell;
  }
  return forms;
}
