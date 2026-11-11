/**
 * Verb morphology engine: draft aspect forms for a Tagalog root with a given affix.
 *
 * Pure rule output, no I/O. The tables it produces are drafts for review; drills only ever use
 * reviewed (APPROVED) tables, and irregular verbs are fixed through `VerbEntry.forms` overrides.
 *
 * Aspect morphology in short (Schachter & Otanes): the completed form marks realis with n- (mag- →
 * nag-, ma- → na-) or the -in- infix; the contemplated form reduplicates the first consonant and
 * vowel (CV) of the root; the incompleted form does both.
 */
import type { Affix, FormTable, VerbEntry } from "./types";

export * from "./types";

const VOWELS = new Set(["a", "e", "i", "o", "u"]);

/** Root-initial consonants that take the ni- prefix instead of the -in- infix (nilinis, niyakap). */
const NI_INITIAL = new Set(["l", "y"]);

/** mang- replaces these onsets with the homorganic nasal (bili → mamili); "" is a vowel-initial root (isda → mangisda). */
const NASAL_SUBSTITUTED = new Set(["p", "b", "t", "s", "k", ""]);

/** Nasal onsets absorb the nasal of mang-/ipang- (nood → manood). */
const NASALS = new Set(["m", "n", "ng"]);

function isVowel(ch: string | undefined): boolean {
  return ch !== undefined && VOWELS.has(ch);
}

/** The root's first consonant ("ng" counts as one letter), or "" when the root starts with a vowel. */
function onset(word: string): string {
  if (isVowel(word[0])) return "";
  if (word.startsWith("ng") && isVowel(word[2])) return "ng";
  return word.slice(0, 1);
}

/** First consonant + first vowel of a word: the syllable that aspect reduplication copies. */
function firstSyllable(word: string): string {
  const vowel = [...word].find((ch) => isVowel(ch));
  if (vowel === undefined) throw new Error(`Cannot conjugate "${word}": it has no vowel`);
  return onset(word) + vowel;
}

/** Inserts an infix after the first consonant, or prefixes it to a vowel-initial word. */
function insertAfterOnset(word: string, infix: string): string {
  const head = onset(word);
  return head + infix + word.slice(head.length);
}

/**
 * Joins a prefix to a stem, with a hyphen when a consonant-final prefix meets a vowel
 * (mag + aral → mag-aral). Used for mag-, nag-, ipag-, ipinag-, makapag-, nakapag-, ipang-, ipinang-.
 */
function attach(prefix: string, stem: string): string {
  return !isVowel(prefix.at(-1)) && isVowel(stem[0]) ? `${prefix}-${stem}` : prefix + stem;
}

/** Drops repeated forms while keeping order, so a variant that equals the canonical form disappears. */
function unique(forms: string[]): string[] {
  return [...new Set(forms)];
}

/** Nasal that a mang-/ipang- prefix takes before a given onset: m before labials, n before dentals, ng elsewhere. */
function homorganicNasal(head: string): string {
  if (head === "p" || head === "b" || head === "m") return "m";
  if (["t", "d", "s", "l", "r", "n"].includes(head)) return "n";
  return "ng";
}

/**
 * CV reduplication, the mark of incompleted and contemplated aspect: copy the first consonant and
 * vowel (kain → kakain, luto → luluto, ngisda → ngingisda; clusters copy one consonant:
 * trabaho → tatrabaho), or just the vowel of a vowel-initial root (inom → iinom).
 */
export function reduplicate(root: string): string {
  return firstSyllable(root) + root;
}

/** The -um- infix goes before the first vowel (kain → kumain); vowel-initial words take um- (inom → uminom). */
export function infixUm(word: string): string {
  return insertAfterOnset(word, "um");
}

/**
 * The -in- infix of completed object-focus forms goes before the first vowel (kain → kinain,
 * inom → ininom). Roots beginning with l or y take the prefix ni- instead (linis → nilinis).
 * w-initial roots keep the infix (walis → winalis).
 */
export function infixIn(word: string): string {
  return NI_INITIAL.has(word.slice(0, 1)) ? `ni${word}` : insertAfterOnset(word, "in");
}

/**
 * Root + -in/-an suffix. Applies, in order: the syncopated `stem` when the verb has one
 * (bili → bilhin); otherwise o → u raising in the final syllable (inom → inumin), d → r between
 * vowels (bayad → bayaran), and an h before the suffix when the root ends in a vowel without a
 * final glottal stop (basa → basahin, but luto → lutuin).
 */
export function suffix(verb: VerbEntry, ending: "in" | "an"): string {
  if (verb.stem) return verb.stem + ending;
  const base = verb.root.replace(/o([^aeiou]*)$/, "u$1").replace(/([aeiou])d$/, "$1r");
  const linker = isVowel(base.at(-1)) && !verb.glottal ? "h" : "";
  return base + linker + ending;
}

/**
 * mang- nasal assimilation, split into the nasal kept before the root and the root it attaches
 * to. p/b, t/s and k are replaced by m, n and ng (bili → mili, tahi → nahi, kuha → nguha); a
 * vowel-initial root gains ng as its onset (isda → ngisda); nasal-initial roots absorb the
 * nasal (nood); d, l, r, h, g, y, w stay after the nasal (daya → n + daya, hingi → ng + hingi).
 * Reduplication copies the first syllable of `base`: namimili, nangingisda, nanghihingi.
 */
function mangParts(root: string): { nasal: string; base: string } {
  const head = onset(root);
  if (NASALS.has(head)) return { nasal: "", base: root };
  const nasal = homorganicNasal(head);
  if (NASAL_SUBSTITUTED.has(head)) return { nasal: "", base: nasal + root.slice(head.length) };
  return { nasal, base: root };
}

/** The mang- infinitive with its nasal assimilated to the root (see `mangParts`): bili → mamili. */
export function nasalise(root: string): string {
  const { nasal, base } = mangParts(root);
  return `ma${nasal}${base}`;
}

/**
 * Recently completed aspect (katatapos): ka- + CV reduplication (kakakain, katutulog), with the
 * colloquial doubled ka- (kakatulog) as an accepted variant.
 */
function recent(root: string): string[] {
  return unique([`ka${reduplicate(root)}`, `kaka${root}`]);
}

/**
 * Incompleted object-focus form of an already reduplicated word. l/y-initial roots also accept the
 * colloquial infixed form (nililinis → linilinis).
 */
function incompletedObject(reduplicated: string): string[] {
  const colloquial = NI_INITIAL.has(reduplicated.slice(0, 1)) ? [insertAfterOnset(reduplicated, "in")] : [];
  return unique([infixIn(reduplicated), ...colloquial]);
}

/** Forms built from a prefix pair (irrealis/realis) around a root, the pattern shared by ma-, maki-, magpa- etc. */
function prefixed(irrealis: string, realis: string, root: string, join = (p: string, s: string) => p + s): FormTable {
  return {
    infinitive: [join(irrealis, root)],
    completed: [join(realis, root)],
    incompleted: [join(realis, reduplicate(root))],
    contemplated: [join(irrealis, reduplicate(root))],
  };
}

/** Rule output per affix, before overrides. */
const RULES: Record<Affix, (verb: VerbEntry) => FormTable> = {
  um: ({ root }) => ({
    infinitive: [infixUm(root)],
    completed: [infixUm(root)],
    incompleted: [infixUm(reduplicate(root))],
    contemplated: [reduplicate(root)],
    recent: recent(root),
  }),
  mag: ({ root }) => ({ ...prefixed("mag", "nag", root, attach), recent: recent(root) }),
  ma: ({ root }) => ({ ...prefixed("ma", "na", root), recent: recent(root) }),
  ma_obj: ({ root }) => prefixed("ma", "na", root),
  mang: ({ root }) => {
    const { nasal, base } = mangParts(root);
    return prefixed(`ma${nasal}`, `na${nasal}`, base);
  },
  // Ability: the formal form reduplicates the root (nakaluluto), the colloquial one doubles ka- (nakakaluto).
  maka: ({ root }) => ({
    infinitive: [`maka${root}`],
    completed: [`naka${root}`],
    incompleted: unique([`naka${reduplicate(root)}`, `nakaka${root}`]),
    contemplated: unique([`maka${reduplicate(root)}`, `makaka${root}`]),
  }),
  makapag: ({ root }) => ({
    infinitive: [attach("makapag", root)],
    completed: [attach("nakapag", root)],
    incompleted: unique([attach("nakapag", reduplicate(root)), attach("nakakapag", root)]),
    contemplated: unique([attach("makapag", reduplicate(root)), attach("makakapag", root)]),
  }),
  // magpa- and maki- reduplicate their own last syllable rather than the root: nagpapaluto, nakikikain.
  magpa: ({ root }) => ({
    infinitive: [`magpa${root}`],
    completed: [`nagpa${root}`],
    incompleted: [`nagpapa${root}`],
    contemplated: [`magpapa${root}`],
  }),
  maki: ({ root }) => ({
    infinitive: [`maki${root}`],
    completed: [`naki${root}`],
    incompleted: [`nakiki${root}`],
    contemplated: [`makiki${root}`],
  }),
  // -in drops its suffix in the completed and incompleted forms (kinain, kinakain).
  in: (verb) => ({
    infinitive: [suffix(verb, "in")],
    completed: [infixIn(verb.root)],
    incompleted: incompletedObject(reduplicate(verb.root)),
    contemplated: [firstSyllable(verb.root) + suffix(verb, "in")],
  }),
  // -an keeps its suffix throughout (binayaran, binabayaran).
  an: (verb) => {
    const suffixed = suffix(verb, "an");
    const reduplicated = firstSyllable(verb.root) + suffixed;
    return {
      infinitive: [suffixed],
      completed: [infixIn(suffixed)],
      incompleted: incompletedObject(reduplicated),
      contemplated: [reduplicated],
    };
  },
  // i- + -in-: ibinigay; vowel- and l/y-initial roots take ini- (iniabot, inilagay).
  i: ({ root }) => {
    const realis = (word: string) => `i${isVowel(word[0]) ? `ni${word}` : infixIn(word)}`;
    return {
      infinitive: [`i${root}`],
      completed: [realis(root)],
      incompleted: [realis(reduplicate(root))],
      contemplated: [`i${reduplicate(root)}`],
    };
  },
  ipag: ({ root }) => prefixed("ipag", "ipinag", root, attach),
  // ipang- assimilates its nasal but, unlike mang-, keeps the root's consonant: ipambili, ipansulat, ipanghiwa.
  ipang: ({ root }) => {
    const head = onset(root);
    const nasal = NASALS.has(head) ? "" : homorganicNasal(head);
    return prefixed(`ipa${nasal}`, `ipina${nasal}`, root, attach);
  },
  // Causative object focus: pa- + root + -in. Formal reduplication copies the root (pinapupunta),
  // colloquial copies pa- (pinapapunta).
  pa_in: (verb) => {
    const suffixed = suffix(verb, "in");
    return {
      infinitive: [`pa${suffixed}`],
      completed: [infixIn(`pa${verb.root}`)],
      incompleted: unique([`pina${reduplicate(verb.root)}`, `pinapa${verb.root}`]),
      contemplated: unique([`pa${firstSyllable(verb.root)}${suffixed}`, `papa${suffixed}`]),
    };
  },
};

/**
 * All aspect forms of `verb` with `affix`: the rule output, with every cell given in
 * `verb.forms[affix]` replacing the rule's cell wholesale (kuha + -in → kunin). Overrides for a cell
 * the affix does not have (`recent` outside um-, mag-, ma-) are ignored.
 */
export function conjugate(verb: VerbEntry, affix: Affix): FormTable {
  const table = RULES[affix](verb);
  const overrides = verb.forms[affix] ?? {};
  for (const form of Object.keys(table) as (keyof FormTable)[]) {
    const override = overrides[form];
    if (override) table[form] = [...override];
  }
  return table;
}
