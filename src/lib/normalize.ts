/**
 * Text normalisation shared by answer grading and the grammar engine's word analysis.
 *
 * Kept in its own module so both `@/lib/game/grading` and `@/lib/grammar/analyse` can use it
 * without importing each other.
 */

/**
 * Canonical form used for comparisons: lower-case, accents removed (Tagalog sometimes marks
 * stress, e.g. "pô"), hyphens dropped ("mag-aral" == "magaral"), punctuation stripped and
 * whitespace collapsed.
 */
export function normalizeAnswer(input: string): string {
  return input
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLocaleLowerCase("en")
    .replace(/[-‐‑–—]/g, "")
    .replace(/[^\p{L}\p{N}\s']/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}
