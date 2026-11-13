/**
 * Splits chat text into words and the gaps between them, so a message can be rendered with its
 * known verbs tappable while punctuation and spacing come out exactly as written. Pure, so the
 * server's lookup keys and the browser's rendering agree.
 */
import { normalizeAnswer } from "@/lib/normalize";

/** A run of text: a word (letters, with inner hyphens or apostrophes) or whatever sits between words. */
export type Token = { text: string; word: boolean };

/** Most distinct words one lookup takes; a chat reply is far shorter, and the server refuses more. */
export const LOOKUP_MAX_WORDS = 60;

const WORD = /\p{L}[\p{L}\p{M}]*(?:['’-][\p{L}\p{M}]+)*/gu;

/** The text as consecutive tokens; joining their `text` gives the input back. */
export function tokenize(text: string): Token[] {
  const tokens: Token[] = [];
  let last = 0;
  for (const m of text.matchAll(WORD)) {
    if (m.index > last) tokens.push({ text: text.slice(last, m.index), word: false });
    tokens.push({ text: m[0], word: true });
    last = m.index + m[0].length;
  }
  if (last < text.length) tokens.push({ text: text.slice(last), word: false });
  return tokens;
}

/** The distinct normalised words of `tokens` (the keys word lookup uses), in order of first appearance. */
export function wordKeys(tokens: readonly Token[]): string[] {
  return [...new Set(tokens.filter((t) => t.word).map((t) => normalizeAnswer(t.text)))];
}

/**
 * The entry for `text` in a lookup result keyed by normalised word. Only own keys count, so a word
 * like "constructor" is not mistaken for an inherited property.
 */
export function lookupFor<T>(found: Readonly<Record<string, T>>, text: string): T | undefined {
  const key = normalizeAnswer(text);
  return Object.hasOwn(found, key) ? found[key] : undefined;
}
