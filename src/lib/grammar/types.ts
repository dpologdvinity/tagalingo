/**
 * Shared vocabulary of the grammar engine: verb affixes, aspect forms, form tables and verb entries.
 *
 * Aspect names follow Schachter & Otanes: "completed" (perfective), "incompleted" (imperfective),
 * "contemplated" (contemplative), plus the infinitive (also the command form) and the
 * recently-completed form (ka- + CV reduplication), which only actor-focus um-, mag- and ma- verbs have.
 */

/**
 * Verb affixes the engine conjugates. Actor focus: um, mag, ma, mang, maka (ability), makapag
 * (ability, mag- verbs), magpa (causative), maki (social). Object/other focus: in, i, an, ipag
 * (benefactive), ipang (instrumental), pa_in (causative object focus) and ma_obj (ma- object focus,
 * e.g. makita).
 */
export type Affix =
  | "um"
  | "mag"
  | "ma"
  | "mang"
  | "maka"
  | "makapag"
  | "magpa"
  | "maki"
  | "in"
  | "i"
  | "an"
  | "ipag"
  | "ipang"
  | "pa_in"
  | "ma_obj";

/** Every affix, in course order; matches the Prisma `VerbAffix` enum. */
export const AFFIXES: readonly Affix[] = [
  "um",
  "mag",
  "ma",
  "mang",
  "maka",
  "makapag",
  "magpa",
  "maki",
  "in",
  "i",
  "an",
  "ipag",
  "ipang",
  "pa_in",
  "ma_obj",
];

/** Every verb form, in the order tables show them. */
export const VERB_FORMS = ["infinitive", "completed", "incompleted", "contemplated", "recent"] as const;

export type VerbForm = (typeof VERB_FORMS)[number];

/**
 * All forms of one verb with one affix. Each cell lists index 0 as the canonical form and any
 * accepted variants after it (e.g. colloquial `nakakapagluto` next to `nakapagluluto`).
 * `recent` is present only for um-, mag- and ma- verbs.
 */
export type FormTable = {
  infinitive: string[];
  completed: string[];
  incompleted: string[];
  contemplated: string[];
  recent?: string[];
};

/** A verb as authored in course content (`verbs:` under a skill). */
export type VerbEntry = {
  root: string;
  en: string;
  affixes: Affix[];
  /** True when the root ends in an (unwritten) glottal stop: luto → lutuin, not lutuhin. */
  glottal: boolean;
  /** Syncopated stem used before -in/-an when the root contracts, e.g. bili → "bilh" (bilhin). */
  stem: string | null;
  /** Explicit per-affix overrides; each given cell replaces the rule output wholesale. */
  forms: Partial<Record<Affix, Partial<Record<VerbForm, string[]>>>>;
};

/** Learner-facing names of each form, in English and in Tagalog grammar terms. */
export const FORM_LABEL: Record<VerbForm, { en: string; tl: string }> = {
  infinitive: { en: "infinitive / command", tl: "pawatas" },
  completed: { en: "past", tl: "perpektibo" },
  incompleted: { en: "present", tl: "imperpektibo" },
  contemplated: { en: "future", tl: "kontemplatibo" },
  recent: { en: "just did", tl: "katatapos" },
};
