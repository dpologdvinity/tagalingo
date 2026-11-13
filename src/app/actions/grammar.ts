"use server";
/**
 * Word lookup for the verb sheet: which approved verb tables a Tagalog word appears in. Lookup is a
 * convenience on top of text that already shows, so a missing session or malformed input answers
 * "nothing found" rather than an error.
 */
import { z } from "zod";
import { LOOKUP_MAX_WORDS, lookupWords, type VerbLookup } from "@/server/grammar";
import { getCurrentUser } from "@/server/session";

const wordsSchema = z.array(z.string().max(80)).max(LOOKUP_MAX_WORDS);

/** Tables for each word of a message, keyed by the word's normalised form; unknown words are absent. */
export async function lookupWordsAction(words: unknown): Promise<Record<string, VerbLookup[]>> {
  if (!(await getCurrentUser())) return {};
  const parsed = wordsSchema.safeParse(words);
  return parsed.success ? lookupWords(parsed.data) : {};
}

/** Tables for one word (grouped by table, every reading kept); empty when it is not a known verb form. */
export async function lookupWordAction(word: unknown): Promise<VerbLookup[]> {
  const parsed = z.string().max(80).safeParse(word);
  if (!parsed.success) return [];
  return Object.values(await lookupWordsAction([parsed.data]))[0] ?? [];
}
