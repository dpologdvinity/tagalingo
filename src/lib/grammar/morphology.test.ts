/**
 * Fixture tests for the verb morphology engine. Every cell of the spec §3 table is a fixture,
 * plus the morphophonemic edge cases (vowel-initial roots, l/y-initial roots, the glottal flag,
 * syncope, o→u raising, d→r, mang- assimilation, maka- variants, recent forms). These fixtures
 * double as the native-speaker review list for the engine's rule output.
 */
import { describe, expect, it } from "vitest";
import { conjugate, infixIn, infixUm, nasalise, reduplicate, suffix } from "./morphology";
import { AFFIXES, FORM_LABEL, VERB_FORMS, type Affix, type FormTable, type VerbEntry } from "./types";

/** Builds a verb entry with the defaults most roots share (no final glottal stop, no syncope). */
function verb(root: string, extra: Partial<VerbEntry> = {}): VerbEntry {
  return { root, en: root, affixes: [], glottal: false, stem: null, forms: {}, ...extra };
}

/** Shorthand for a table with one canonical form per cell. */
function table(infinitive: string, completed: string, incompleted: string, contemplated: string): FormTable {
  return { infinitive: [infinitive], completed: [completed], incompleted: [incompleted], contemplated: [contemplated] };
}

const kain = verb("kain");
const luto = verb("luto", { glottal: true });
const tulog = verb("tulog");
const bili = verb("bili", { stem: "bilh" });

// Spec §3 table, one row per affix.
const SPEC_TABLE: [VerbEntry, Affix, FormTable][] = [
  [kain, "um", { ...table("kumain", "kumain", "kumakain", "kakain"), recent: ["kakakain"] }],
  [luto, "mag", { ...table("magluto", "nagluto", "nagluluto", "magluluto"), recent: ["kaluluto", "kakaluto"] }],
  [tulog, "ma", { ...table("matulog", "natulog", "natutulog", "matutulog"), recent: ["katutulog", "kakatulog"] }],
  [bili, "mang", table("mamili", "namili", "namimili", "mamimili")],
  // The spec lists "nakakain" as an incompleted variant; it is the completed form, so it is left out (see report).
  [kain, "maka", table("makakain", "nakakain", "nakakakain", "makakakain")],
  [
    luto,
    "makapag",
    {
      infinitive: ["makapagluto"],
      completed: ["nakapagluto"],
      incompleted: ["nakapagluluto", "nakakapagluto"],
      contemplated: ["makapagluluto", "makakapagluto"],
    },
  ],
  [luto, "magpa", table("magpaluto", "nagpaluto", "nagpapaluto", "magpapaluto")],
  [kain, "maki", table("makikain", "nakikain", "nakikikain", "makikikain")],
  [kain, "in", table("kainin", "kinain", "kinakain", "kakainin")],
  [verb("bigay"), "i", table("ibigay", "ibinigay", "ibinibigay", "ibibigay")],
  [verb("bayad"), "an", table("bayaran", "binayaran", "binabayaran", "babayaran")],
  [verb("hiwa", { glottal: true }), "ipang", table("ipanghiwa", "ipinanghiwa", "ipinanghihiwa", "ipanghihiwa")],
  [luto, "ipag", table("ipagluto", "ipinagluto", "ipinagluluto", "ipagluluto")],
  [
    verb("punta"),
    "pa_in",
    {
      infinitive: ["papuntahin"],
      completed: ["pinapunta"],
      incompleted: ["pinapupunta", "pinapapunta"],
      contemplated: ["papupuntahin", "papapuntahin"],
    },
  ],
  [verb("kita"), "ma_obj", table("makita", "nakita", "nakikita", "makikita")],
];

// Morphophonemic edge cases from the task brief, plus a few that pin down the rules' boundaries.
const EDGE_CASES: [VerbEntry, Affix, FormTable][] = [
  // Vowel-initial roots: um- becomes a prefix; consonant-final prefixes take a hyphen.
  [verb("inom"), "um", { ...table("uminom", "uminom", "umiinom", "iinom"), recent: ["kaiinom", "kakainom"] }],
  // Recent forms of vowel-initial mag- roots are not asserted (kaaaral is rare in writing).
  [verb("aral"), "mag", { ...table("mag-aral", "nag-aral", "nag-aaral", "mag-aaral"), recent: expect.any(Array) }],
  [
    verb("aral"),
    "makapag",
    {
      infinitive: ["makapag-aral"],
      completed: ["nakapag-aral"],
      incompleted: ["nakapag-aaral", "nakakapag-aral"],
      contemplated: ["makapag-aaral", "makakapag-aral"],
    },
  ],
  [verb("ahit"), "ipag", table("ipag-ahit", "ipinag-ahit", "ipinag-aahit", "ipag-aahit")],
  [verb("ahit"), "ipang", table("ipang-ahit", "ipinang-ahit", "ipinang-aahit", "ipang-aahit")],
  // l-initial roots take ni- instead of -in-; the colloquial infixed variant is accepted when reduplicated.
  [
    verb("linis"),
    "in",
    {
      infinitive: ["linisin"],
      completed: ["nilinis"],
      incompleted: ["nililinis", "linilinis"],
      contemplated: ["lilinisin"],
    },
  ],
  [
    verb("linis"),
    "an",
    {
      infinitive: ["linisan"],
      completed: ["nilinisan"],
      incompleted: ["nililinisan", "linilinisan"],
      contemplated: ["lilinisan"],
    },
  ],
  // w-initial roots keep the -in- infix (winalis, not niwalis).
  [verb("walis"), "an", table("walisan", "winalisan", "winawalisan", "wawalisan")],
  // The glottal flag decides -in vs -hin.
  [verb("basa"), "in", table("basahin", "binasa", "binabasa", "babasahin")],
  [
    luto,
    "in",
    {
      infinitive: ["lutuin"],
      completed: ["niluto"],
      incompleted: ["niluluto", "linuluto"],
      contemplated: ["lulutuin"],
    },
  ],
  [verb("punta"), "an", table("puntahan", "pinuntahan", "pinupuntahan", "pupuntahan")],
  // Syncope through `stem`; the completed and incompleted -in forms carry no suffix, so they use the full root.
  [bili, "in", table("bilhin", "binili", "binibili", "bibilhin")],
  [bili, "an", table("bilhan", "binilhan", "binibilhan", "bibilhan")],
  [verb("dala", { stem: "dalh" }), "in", table("dalhin", "dinala", "dinadala", "dadalhin")],
  // Explicit overrides replace whole cells; the rest stays rule output.
  [
    verb("kuha", { forms: { in: { infinitive: ["kunin"], contemplated: ["kukunin"] } } }),
    "in",
    table("kunin", "kinuha", "kinukuha", "kukunin"),
  ],
  // o → u raising in the final syllable before a suffix.
  [verb("inom"), "in", table("inumin", "ininom", "iniinom", "iinumin")],
  [
    verb("inom"),
    "pa_in",
    {
      infinitive: ["painumin"],
      completed: ["pinainom"],
      incompleted: ["pinaiinom", "pinapainom"],
      contemplated: ["paiinumin", "papainumin"],
    },
  ],
  // mang- nasal assimilation: p/b → m, t/s → n, k → ng (initial consonant dropped); vowels take ng.
  [verb("nood"), "mang", table("manood", "nanood", "nanonood", "manonood")],
  [verb("isda"), "mang", table("mangisda", "nangisda", "nangingisda", "mangingisda")],
  [verb("kuha"), "mang", table("manguha", "nanguha", "nangunguha", "mangunguha")],
  [verb("tahi"), "mang", table("manahi", "nanahi", "nananahi", "mananahi")],
  // Consonants that keep their place after the nasal: l (man-), h (mang-).
  [verb("loko"), "mang", table("manloko", "nanloko", "nanloloko", "manloloko")],
  [verb("huli", { glottal: true }), "mang", table("manghuli", "nanghuli", "nanghuhuli", "manghuhuli")],
  // ipang- assimilates the nasal but keeps the root's first consonant.
  [verb("bili"), "ipang", table("ipambili", "ipinambili", "ipinambibili", "ipambibili")],
  [verb("sulat"), "ipang", table("ipansulat", "ipinansulat", "ipinansusulat", "ipansusulat")],
  // i- with vowel- or l-initial roots: ini- + root.
  [verb("abot"), "i", table("iabot", "iniabot", "iniaabot", "iaabot")],
  [verb("lagay"), "i", table("ilagay", "inilagay", "inilalagay", "ilalagay")],
  // maka- variants: formal CV reduplication of the root, colloquial reduplication of ka-.
  [
    luto,
    "maka",
    {
      infinitive: ["makaluto"],
      completed: ["nakaluto"],
      incompleted: ["nakaluluto", "nakakaluto"],
      contemplated: ["makaluluto", "makakaluto"],
    },
  ],
  // Other prefixes with vowel-initial roots: no hyphen after a vowel-final prefix.
  [
    verb("upo", { glottal: true }),
    "ma",
    { ...table("maupo", "naupo", "nauupo", "mauupo"), recent: ["kauupo", "kakaupo"] },
  ],
  [verb("inom"), "maki", table("makiinom", "nakiinom", "nakikiinom", "makikiinom")],
  // um- with an l-initial root is still an infix.
  [verb("lakad"), "um", { ...table("lumakad", "lumakad", "lumalakad", "lalakad"), recent: ["kalalakad", "kakalakad"] }],
];

describe("conjugate", () => {
  describe.each([
    ["spec §3 table", SPEC_TABLE],
    ["edge cases", EDGE_CASES],
  ])("%s", (_name, fixtures) => {
    it.each(fixtures.map(([v, affix, expected]) => [v.root, affix, v, expected] as const))(
      "%s + %s",
      (_root, affix, v, expected) => {
        expect(conjugate(v, affix)).toEqual(expected);
      },
    );
  });

  it("produces a recent form only for um, mag and ma", () => {
    const withRecent = AFFIXES.filter((affix) => "recent" in conjugate(kain, affix));
    expect(withRecent).toEqual(["um", "mag", "ma"]);
  });

  it("ignores overrides for cells the affix does not have", () => {
    const v = verb("kain", { forms: { in: { recent: ["kakakain"] } } });
    expect(conjugate(v, "in")).not.toHaveProperty("recent");
  });

  it("does not share arrays with the verb entry", () => {
    const v = verb("kuha", { forms: { in: { infinitive: ["kunin"] } } });
    const result = conjugate(v, "in");
    result.infinitive.push("x");
    expect(v.forms.in?.infinitive).toEqual(["kunin"]);
  });
});

describe("helpers", () => {
  it("reduplicate copies the first consonant and vowel", () => {
    expect(reduplicate("kain")).toBe("kakain");
    expect(reduplicate("inom")).toBe("iinom");
    expect(reduplicate("luto")).toBe("luluto");
    expect(reduplicate("ngisda")).toBe("ngingisda");
    expect(reduplicate("trabaho")).toBe("tatrabaho");
  });

  it("infixUm puts -um- before the first vowel", () => {
    expect(infixUm("kain")).toBe("kumain");
    expect(infixUm("inom")).toBe("uminom");
    expect(infixUm("nguya")).toBe("ngumuya");
  });

  it("infixIn puts -in- before the first vowel, or ni- before l and y", () => {
    expect(infixIn("kain")).toBe("kinain");
    expect(infixIn("inom")).toBe("ininom");
    expect(infixIn("linis")).toBe("nilinis");
    expect(infixIn("yakap")).toBe("niyakap");
    expect(infixIn("walis")).toBe("winalis");
  });

  it("suffix applies the glottal flag, o→u raising, d→r and the syncopated stem", () => {
    expect(suffix(verb("basa"), "in")).toBe("basahin");
    expect(suffix(verb("luto", { glottal: true }), "in")).toBe("lutuin");
    expect(suffix(verb("inom"), "in")).toBe("inumin");
    expect(suffix(verb("bayad"), "an")).toBe("bayaran");
    expect(suffix(verb("bili", { stem: "bilh" }), "in")).toBe("bilhin");
  });

  it("nasalise returns the mang- infinitive with the nasal assimilated", () => {
    expect(nasalise("bili")).toBe("mamili");
    expect(nasalise("pasyal")).toBe("mamasyal");
    expect(nasalise("tahi")).toBe("manahi");
    expect(nasalise("sulat")).toBe("manulat");
    expect(nasalise("kuha")).toBe("manguha");
    expect(nasalise("isda")).toBe("mangisda");
    expect(nasalise("nood")).toBe("manood");
    expect(nasalise("daya")).toBe("mandaya");
    expect(nasalise("loko")).toBe("manloko");
    expect(nasalise("hingi")).toBe("manghingi");
  });
});

describe("labels", () => {
  it("lists every form with an English and a Tagalog label", () => {
    expect(VERB_FORMS).toEqual(["infinitive", "completed", "incompleted", "contemplated", "recent"]);
    expect(FORM_LABEL).toEqual({
      infinitive: { en: "infinitive / command", tl: "pawatas" },
      completed: { en: "past", tl: "perpektibo" },
      incompleted: { en: "present", tl: "imperpektibo" },
      contemplated: { en: "future", tl: "kontemplatibo" },
      recent: { en: "just did", tl: "katatapos" },
    });
  });
});
