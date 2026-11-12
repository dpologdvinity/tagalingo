/**
 * File-only loader for the approved verb tables exported to content/<lang>/grammar/verbs.json.
 *
 * Unlike the studio's database helpers this needs no connection, so tests, scripts and CI can
 * validate content against the reviewed tables. The file shape is
 * `{ verbs: { root, affix, en, forms, irregular, reviewNote }[] }`; only the fields `analyse`
 * needs (`VerbTableData`) are returned. A missing file means "no verbs approved yet".
 */
import fs from "node:fs";
import path from "node:path";
import { z } from "zod";
import type { VerbTableData } from "./analyse";
import { AFFIXES, type Affix } from "./types";

/** Default content directory (the shipped Tagalog course), resolved from the working directory. */
const DEFAULT_CONTENT_DIR = path.join("content", "tagalog");

const spelling = z.string().trim().min(1);
/** A cell lists the canonical spelling first, then accepted variants. */
const cell = z.array(spelling).min(1);

const verbFileSchema = z.object({
  verbs: z.array(
    z.object({
      root: spelling,
      affix: z.enum(AFFIXES as unknown as readonly [Affix, ...Affix[]]),
      en: spelling,
      forms: z.object({
        infinitive: cell,
        completed: cell,
        incompleted: cell,
        contemplated: cell,
        /** Only um-, mag- and ma- verbs have a recently-completed form. */
        recent: cell.optional(),
      }),
      irregular: z.boolean(),
      reviewNote: z.string(),
    }),
  ),
});

/**
 * Reads `<contentDir>/grammar/verbs.json` and returns its tables, or `[]` when the file is absent.
 * Throws an error naming the file when it is not valid JSON or does not match the schema.
 */
export function loadApprovedVerbs(
  contentDir: string = path.resolve(process.cwd(), DEFAULT_CONTENT_DIR),
): VerbTableData[] {
  const file = path.join(contentDir, "grammar", "verbs.json");
  let raw: string;
  try {
    raw = fs.readFileSync(file, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw error;
  }

  let json: unknown;
  try {
    json = JSON.parse(raw);
  } catch (error) {
    throw new Error(`${file} is not valid JSON: ${(error as Error).message}`);
  }

  const result = verbFileSchema.safeParse(json);
  if (!result.success) {
    const summary = result.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("\n  ");
    throw new Error(`Invalid verbs.json (${file}):\n  ${summary}`);
  }
  return result.data.verbs.map(({ root, affix, en, forms }) => ({ root, affix, en, forms }));
}
