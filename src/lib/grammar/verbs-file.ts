/**
 * File-only loader for the approved verb tables exported to content/<lang>/grammar/verbs.json.
 *
 * Unlike the studio's database helpers this needs no connection, so tests, scripts and CI can
 * validate content against the reviewed tables. The file shape is
 * `{ verbs: { root, affix, en, forms, irregular, reviewNote }[] }` (`VerbFileEntry`); `irregular`
 * lists the forms a reviewer deliberately changed from the engine's rule output. `loadApprovedVerbs`
 * returns only the fields `analyse` needs (`VerbTableData`); `readVerbFile` returns whole entries
 * for the database import. A missing file means "no verbs approved yet".
 */
import fs from "node:fs";
import path from "node:path";
import { z } from "zod";
import type { VerbTableData } from "./analyse";
import { AFFIXES, VERB_FORMS, type Affix } from "./types";

/** Default content directory (the shipped Tagalog course), resolved from the working directory. */
const DEFAULT_CONTENT_DIR = path.join("content", "tagalog");

const spelling = z.string().trim().min(1);
/** A cell lists the canonical spelling first, then accepted variants. */
const cell = z.array(spelling).min(1);

/** Schema of `grammar/verbs.json`; the single definition shared by the reader and the DB export. */
export const verbFileSchema = z.object({
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
      /** Forms that intentionally differ from the engine's rule output; any other difference is a mistake. */
      irregular: z.array(z.enum(VERB_FORMS)),
      reviewNote: z.string(),
    }),
  ),
});

export type VerbFileEntry = z.infer<typeof verbFileSchema>["verbs"][number];

/** Where the approved verb tables live inside a content directory. */
export const verbsFilePath = (contentDir: string) => path.join(contentDir, "grammar", "verbs.json");

/**
 * Reads `<contentDir>/grammar/verbs.json` and returns its entries, or `[]` when the file is absent.
 * Throws an error naming the file when it is not valid JSON or does not match the schema.
 */
export function readVerbFile(contentDir: string): VerbFileEntry[] {
  const file = verbsFilePath(contentDir);
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
  return result.data.verbs;
}

/** The approved tables in `<contentDir>/grammar/verbs.json` as the analyser sees them, or `[]` when absent. */
export function loadApprovedVerbs(
  contentDir: string = path.resolve(process.cwd(), DEFAULT_CONTENT_DIR),
): VerbTableData[] {
  return readVerbFile(contentDir).map(({ root, affix, en, forms }) => ({ root, affix, en, forms }));
}
