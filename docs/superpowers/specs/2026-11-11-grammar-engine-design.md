# Grammar engine — design

**Date:** 2026-11-11 · **Status:** approved in conversation, awaiting written-spec review
**Project:** 1 of 4 in the "teach grammar to fluency" effort (see [Related projects](#related-projects))

## Goal

Tagalingo teaches vocabulary well but grammar only as untested tips. The owner wants the app to
take a learner from zero towards fluency, keeping the Duolingo-like feel. This project builds the
machinery for teaching grammar: patterns as first-class data, cards that introduce them inside
lessons, drills that practise them, per-learner tracking, and a native-speaker review workflow.
It also retrofits the existing four units with the grammar they already touch.

**Audience.** The owner first (starting from zero), possibly a public app for zero-level learners
later. Explanations are plain English; past/present/future labels first, Tagalog aspect names
taught alongside.

**Quality bar.** "Superb": accuracy over speed. Complexity is acceptable where it buys
correctness. All content is original (written in-session by Claude Code, no API key involved),
machine-checked, then reviewed by the owner's native-speaker contact.

## Decisions taken during brainstorming

| Question                 | Decision                                                                                                                                            |
| ------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------- |
| How grammar is presented | Short card the first time a pattern appears in a lesson, then drills (not a separate grammar track).                                                |
| Where grammar lives      | Approach A: tracked patterns. Defined once, referenced by lessons, every drill tagged with its pattern(s).                                          |
| Native review            | Available. All grammar content passes through the Studio review queue.                                                                              |
| Verb forms               | Root + infinitive + completed + incompleted + contemplated (+ recently-completed where it exists), always stored separately even when two coincide. |
| Who writes content       | Claude Code, in session. The API-key `ClaudeGenerator` is **not** extended for grammar.                                                             |
| Competitor material      | Never copied or paraphrased. Competitor _topic lists_ are used only as a coverage checklist in project 2.                                           |

## 1. Learner experience

- **Grammar card.** Before the first exercise in a lesson that tests a pattern the learner has not
  yet seen, a card slides in: one-line rule, optional table (root column first), 2–3 example
  sentences with audio, "Got it". Not graded, no hearts.
- **"?" chip.** Every exercise tagged with a pattern the learner has seen shows a chip that reopens
  that pattern's card (modal; does not affect grading).
- **Explained feedback.** Wrong grammar answers show the relevant rule, not just the right answer
  (see §4 "Feedback").
- **Grammar page** (`/grammar`). Every unlocked pattern in course order with card, strength label
  and meter, and "Practise this". Locked patterns are listed greyed-out by title only. A
  "Practise your weakest grammar" button sits at the top.
- **Skill page.** New "Grammar" section listing the skill's pattern cards (plus verb tables for the
  skill's verbs), next to tips and flashcards.
- **Path.** Skill nodes list the patterns they teach in the placard.
- **Word lookup.** On the grammar page, skill pages and in Tala's chat messages, tapping a Tagalog
  verb opens a sheet with its root, affix and full approved form table (when the verb is known).
- Hearts, XP, streak, league and path rules are unchanged. Grammar drills are ordinary exercises.

## 2. Content format and data model

### `course.yaml`

A top-level `grammar:` list (course order = list order):

```yaml
grammar:
  - id: um-aspect # kebab-case, unique
    title: "-um- verbs: past, present, future"
    rule: "Put -um- before the first vowel of the root. ..."
    table: # optional
      head: [root, infinitive, past, present, future]
      rows: [[kain, kumain, kumain, kumakain, kakain]]
    examples: # [tl, en], 2–3 items
      - [Kumain ako ng kanin., I ate rice.]
    notes: ["Kumain is both 'to eat' and 'ate' — context decides."] # optional
    mistakes: # [wrong answer, explanation]
      - [Kain ako ng kanin., "A finished action needs -um-: Kumain ako ng kanin."]
    requires: [ako-ka-siya] # earlier pattern ids
    drills: # ingredients for the stub generator (§6)
      frames: # conjugate: sentence with ___, English, affix, form
        - ["___ ako ng kanin kahapon.", "I ate rice yesterday.", um, completed]
      transforms: # source, English, instruction, accepted answers
        - ["Kumain ako.", "I ate.", "Make it future", ["Kakain ako."]]
      choices: # sentence with ___, English, options, answer index, why per option
        - [
            "Pupunta ako ___ palengke.",
            "I'll go to the market.",
            [sa, ng, ang],
            0,
            [null, "ng marks the thing acted on, not a place.", "ang marks the topic, not a destination."],
          ]
```

Lessons gain `teaches: [pattern ids]` and `uses: [pattern ids]`. Skills gain `verbs:`:

```yaml
verbs:
  - root: kain
    en: eat
    affixes: [um, in]
    glottal: false # final glottal stop (unwritten); decides -in/-hin, -an/-han
    stem: null # syncopated suffix stem when irregular, e.g. bili → bilh
    forms: {} # explicit overrides per affix/form, e.g. { in: { infinitive: kunin } }
```

**Load-time validation** (in `src/lib/content/course.ts`, each with a failing-input test):

- every pattern id is unique and taught by exactly one lesson; every lesson `teaches`/`uses` id exists;
- `requires` and `uses` never point at a pattern taught later in the course;
- tables, examples, frames and transforms use only words known by the teaching lesson
  (course words up to that lesson + a fixed function-word list + inflected forms of known verbs);
- each `mistakes` entry differs (after normalisation) from every accepted answer it relates to;
- each verb's affixes are known; overrides name real affixes/forms.

### Prisma

```prisma
model GrammarPattern {
  id          String   @id @default(cuid())
  courseId    String
  slug        String                 // the yaml id
  order       Int
  title       String
  card        Json                   // rule, table, examples, notes, mistakes
  lessonId    String                 // lesson that teaches it
  @@unique([courseId, slug])
}

model ExercisePattern {             // many-to-many, FK-checked
  exerciseId  String
  patternId   String
  @@id([exerciseId, patternId])
}

model PatternProgress {
  userId          String
  patternId       String
  seenAt          DateTime?
  attempts        Int      @default(0)
  correct         Int      @default(0)
  strength        Float    @default(0)   // stored EWMA, before time decay
  lastPracticedAt DateTime?
  @@id([userId, patternId])
}

model VerbTable {
  id          String   @id @default(cuid())
  courseId    String
  root        String
  affix       VerbAffix
  en          String
  forms       Json                   // { infinitive: string[], completed: [...], incompleted, contemplated, recent? }
  status      ExerciseStatus         // DRAFT | APPROVED | REJECTED (reused enum)
  irregular   String[]               // forms that intentionally differ from the engine's rule output
  reviewNote  String?
  reviewedById String?
  reviewedAt  DateTime?
  @@unique([courseId, root, affix])
}

model CardFlag {                     // reviewer "flag a problem" notes on cards
  id          String   @id @default(cuid())
  patternId   String
  userId      String
  note        String
  createdAt   DateTime @default(now())
  resolvedAt  DateTime?
}
```

`VerbAffix` enum: `um, mag, ma, mang, maka, makapag, magpa, maki, in, i, an, ipag, ipang, pa_in, ma_obj`.
Each form value is an array: index 0 is the canonical form, the rest are accepted variants
(e.g. `nakakakain`, `nakakain`). `LessonAttempt` gains `patternId String?` and
`weakGrammar Boolean @default(false)` for practice scopes. Relations get `onDelete: Cascade`
and indexes on `ExercisePattern.patternId` and `PatternProgress.patternId`.

Sync (`persist.ts`) upserts patterns from yaml, and verbs from yaml + approved
`content/tagalog/grammar/verbs.json`. Export writes approved verb tables back to that file, next
to the existing exercise export.

## 3. Verb morphology engine

Pure functions in `src/lib/grammar/` (no I/O, fully unit-tested):

- `conjugate(verb, affix) → FormTable` — draft forms for all aspects.
- `analyse(word, knownVerbs) → { root, affix, form }[]` — reverse lookup against approved tables,
  used for the find-root hints, word lookup sheet and "you wrote the present form" feedback.
- `diffFromRule(verb, affix, reviewedTable) → string[]` — forms that differ from the rule output
  (stored as `irregular`; a difference not marked irregular fails validation, catching typos).

Aspect rules by affix (canonical forms; variants listed where common):

| Affix     | Infinitive  | Completed   | Incompleted                   | Contemplated                  | Recently completed    |
| --------- | ----------- | ----------- | ----------------------------- | ----------------------------- | --------------------- |
| -um-      | kumain      | kumain      | kumakain                      | kakain                        | kakakain              |
| mag-      | magluto     | nagluto     | nagluluto                     | magluluto                     | kaluluto / kakaluto   |
| ma-       | matulog     | natulog     | natutulog                     | matutulog                     | katutulog / kakatulog |
| mang-     | mamili      | namili      | namimili                      | mamimili                      | — (not drilled)       |
| maka-     | makakain    | nakakain    | nakakakain / nakakain         | makakakain                    | —                     |
| makapag-  | makapagluto | nakapagluto | nakapagluluto / nakakapagluto | makapagluluto / makakapagluto | —                     |
| magpa-    | magpaluto   | nagpaluto   | nagpapaluto                   | magpapaluto                   | —                     |
| maki-     | makikain    | nakikain    | nakikikain                    | makikikain                    | —                     |
| -in       | kainin      | kinain      | kinakain                      | kakainin                      | —                     |
| i-        | ibigay      | ibinigay    | ibinibigay                    | ibibigay                      | —                     |
| -an       | bayaran     | binayaran   | binabayaran                   | babayaran                     | —                     |
| ipag-     | ipagluto    | ipinagluto  | ipinagluluto                  | ipagluluto                    | —                     |
| ipang-    | ipanghiwa   | ipinanghiwa | ipinanghihiwa                 | ipanghihiwa                   | —                     |
| pa- -in   | papuntahin  | pinapunta   | pinapupunta / pinapapunta     | papupuntahin / papapuntahin   | —                     |
| ma- (obj) | makita      | nakita      | nakikita                      | makikita                      | —                     |

(Example roots are illustrative; every cell above is itself a test fixture and goes on the native
review list.) Morphophonemics handled:

- vowel-initial roots: `um-` prefix (uminom), hyphen after consonant-final prefixes (mag-aral, nag-aaral);
- `-in-` infix vs `ni-` prefix for l/y/w-initial roots (nilinis, nililinis; colloquial variant linilinis);
- `-in/-an` → `-hin/-han` after vowel-final roots without a final glottal stop (`glottal` flag);
- syncope (`stem`: bili → bilhin, dala → dalhin; kuha → kunin via override);
- o → u raising in the final syllable before a suffix (inom → inumin, luto → lutuin);
- d → r between vowels (bayad → bayaran);
- mang- nasal assimilation (p/b → m: mamili; t/d/s → n: manood; k/vowel → ng: mangisda);
- CV reduplication with prefixes, including colloquial double forms as accepted variants.

**Runtime rule:** drills only ever use `APPROVED` verb tables, never raw engine output.

## 4. Exercise types and grading

New types in `src/lib/content/schema.ts` (`parseExercise` first, per AGENTS.md):

| Type        | Payload (server)                                                                                          | Client view                                                                     |
| ----------- | --------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------- |
| `conjugate` | `sentence` (one `___`), `translation`, `root`, `affix`, `form`, `answers[]`                               | everything except `answers`                                                     |
| `find_root` | `word`, `translation?`, `mode: choice\|type`, `options?`, `root`, `hint`                                  | `word`, `translation`, `mode`, `options` (no `root`, `hint` only in feedback)   |
| `transform` | `source`, `sourceEn`, `instruction`, `mode: build\|type`, `answers[][]` (token sequences), `distractors?` | `source`, `sourceEn`, `instruction`, `mode`, shuffled tiles                     |
| `paradigm`  | `root`, `affix`, `en`, `cells: {form, value, hidden}[]`, `distractors[]`                                  | cells with hidden values blanked; tiles = hidden values + distractors, shuffled |

Grading (`src/lib/game/grading.ts`):

- **Strict morphology.** `conjugate`, `find_root` (typed) and `paradigm` accept only listed forms
  after normalisation; no Levenshtein typo tolerance.
- `transform` accepts any listed token sequence (normalised), like `word_bank`.
- `paradigm` is correct only when every hidden cell is right; feedback lists the wrong cells.
- `GradeResult` gains `explanation?: string`.

**Feedback** (computed server-side, sent only after answering):

1. _Wrong form of the right verb_ (`conjugate`): `analyse` finds the typed word in the same
   verb's table → "That's the present form (kumakain). The future is kakain."
2. _Known mistake_: the answer matches an exercise-level `mistakes` entry or its pattern's
   `mistakes` → that explanation.
3. _Per-option why_: `select_translation`, `fill_blank`, `listen_select` and `dialogue` gain an
   optional `why: (string | null)[]` aligned with `options`; a wrong pick shows its `why`.
4. Otherwise the existing "Correct answer: …".

`word_bank` and `type_translation` gain optional `mistakes: {answer, why}[]`. Word-order drills
(enclitics _na/pa/ba/po/din_) are `word_bank` exercises tagged with the pattern.

Answers never reach the client: each new type gets a `toClientExercise` case and a leak test
(serialised client view contains no answer string). Hearts, FREE_MISTAKES (match_pairs, speak) and
re-queueing are unchanged.

## 5. Tracking, strength and practice

- **First answer only.** In `submitAnswer`, inside the existing per-learner lock and transaction,
  if this is the first `AttemptAnswer` for (attempt, exercise), update `PatternProgress` for every
  linked pattern: `attempts += 1`, `correct += r`, `strength += 0.3 × (r − strength)`,
  `lastPracticedAt = now`. Speak skips (`skipped`) do not count.
- **Effective strength** (pure, in `src/lib/game/strength.ts`):
  `strength × 0.5 ^ (daysSince(lastPracticedAt) / 21)`.
- **Labels:** New (0 attempts) · Learning (< 0.6) · Solid (< 0.9) · Mastered (≥ 0.9 and ≥ 8 attempts).
  Six correct answers from zero reach ≈ 0.88 (Solid).
- **Seen.** `completeAttempt` for a LESSON sets `seenAt` (if null) for that lesson's `teaches`.
  Quitting mid-lesson leaves the card unseen.
- **Cards in the player.** `startAttempt` / `startPractice` return
  `cards: { pattern, card }[]` for unseen taught patterns and `exercisePatterns: Record<exerciseId, slug[]>`
  (pattern tags are not secret). The player inserts each card before the first exercise tagged with it.
- **Practice scopes.** `PracticeScope` gains `{ patternId }` (≤ 10 tagged exercises from finished
  lessons) and `{ weakGrammar: true }` (the 3 seen patterns with ≥ 3 attempts and lowest effective
  strength; their drills mixed, ≤ 10). Practice rules (no hearts, practice XP, streak, +1 heart)
  are unchanged. If a scope has no eligible exercises the action returns a friendly error.

## 6. Authoring and review

- **Hand-written input (by Claude Code, in session):** pattern cards, verb entries, drill
  ingredients (`frames`, `transforms`, `choices` with per-option `why`).
- **Stub generator** gains grammar slots driven by the lesson's `teaches`/`uses`: conjugate from
  frames × approved verb tables, find_root from approved forms, paradigm from approved tables,
  transform and choices from the authored lists. Deterministic, tagged with patterns. Lessons that
  teach grammar get 3–5 grammar drills; the rest of the recipe is unchanged.
- **`ClaudeGenerator`** is not extended. Its prompt keeps producing vocabulary drafts only.
- **Automatic checks** (in the generator pipeline; failures go to `rejected`, as today):
  conjugate/paradigm/find_root answers must equal an approved table form; tags ⊆ teaches ∪ uses;
  vocabulary limited to known words; hints/instructions must not contain the answer.
- **Verb pipeline:** `npm run grammar:draft` drafts `VerbTable` rows from yaml + engine →
  Studio "Verbs" grid (per root/affix, audio per cell, editable cells, mark variant, approve) →
  `npm run content:export` writes `content/tagalog/grammar/verbs.json` → seed loads it.
- **Studio "Grammar" tab:** cards rendered as learners see them, with "Flag a problem"
  (`CardFlag`) and a list of open flags. Card text is fixed in yaml by a normal commit.
- **Labels.** Until a person approves, content carries "AI-reviewed during build (Claude);
  awaiting native-speaker review", as current exercises do. Only `APPROVED` content is served.

## 7. Retrofit of Units 1–4

| Skill         | Patterns taught                                                                  |
| ------------- | -------------------------------------------------------------------------------- |
| Pagbati       | `po-opo` politeness                                                              |
| Mga Tao       | `ako-ka-siya` pronouns · `kami-tayo` · `predicate-first` (_Guro ako_, _ay_ form) |
| Pagkain       | `ng-object` (_ng_ for the thing eaten/wanted)                                    |
| Pamilya       | `si-names` (_si_ before names and titles)                                        |
| Mga Numero    | `linkers` (_-ng / na_)                                                           |
| Mga Lugar     | `nasa-nasaan-saan`                                                               |
| Pagpapakilala | `ba-questions` (incl. placement) · `taga`                                        |
| Mga Pandiwa   | `roots` · `um-aspect` · `mag-aspect` · `find-the-root`                           |
| Sa Bahay      | `commands-mo-paki`                                                               |
| Sa Palengke   | none in this project (drafts only today)                                         |

Existing approved vocabulary exercises stay. Grammar drills are added (3–5 per lesson that
teaches a pattern) and existing exercises that already test a pattern get tagged (e.g. current
_ng_ fill-in-the-blanks → `ng-object`). Verbs in the course get `VerbTable`s.

## 8. Testing

- **Unit:** engine fixtures for every affix and morphophonemic rule including irregulars and
  variants; `analyse` round-trips; strength maths and labels; schema + lint for each new type;
  grading (strict morphology, variants, wrong-form feedback, known-mistake feedback, per-option
  why, paradigm partial errors); course validation (each rule with a failing input); client-view
  leak tests; stub grammar slots (tags, answers match approved tables, determinism).
- **Integration (`tagalingo_test`):** PatternProgress first-answer-only update under the lock;
  `seenAt` set on completion only; pattern practice and weak-grammar selection; cards and
  `exercisePatterns` returned by start; verb export/import round-trip; migration on seeded data.
- **E2E (desktop + mobile):** card shows once then "?" reopens it; conjugate drill wrong-form
  feedback; grammar page + "Practise this"; Studio verb grid approve; word lookup sheet.
- Every step keeps `format:check`, `lint`, `typecheck`, unit, integration, build and e2e green.

## 9. Rollout

Small Conventional Commits, CI green between steps:

1. Morphology engine + fixtures.
2. Course format (`grammar`, `teaches`/`uses`, `verbs`) + validation.
3. Prisma models + migration + sync/export/seed.
4. Exercise types, client views, grading, feedback.
5. Player: cards, "?" chip, explained feedback.
6. Tracking, strength, practice scopes.
7. Grammar page, skill-page section, path placard, word lookup.
8. Studio: verb grid, grammar tab, card flags.
9. Retrofit content for Units 1–4; export; reseed.
10. Code review (`superpowers:requesting-code-review`), fixes, docs (README, ARCHITECTURE,
    PLAN, CONTRIBUTING, STEPS-FOR-OWNER: native review of cards, verb tables and drills).

## Out of scope

- Spaced-repetition scheduling (project 4; strength is its input).
- Drills composed on the fly at runtime from tables + templates (bypasses review).
- Extending `ClaudeGenerator` to grammar.
- New units beyond the retrofit (projects 2–3).

## Related projects

2. **Curriculum roadmap (A1 → B2):** unit-by-unit grammar targets and vocabulary themes.
   Coverage is checked against public topic lists (Ling, Rosetta Stone, standard Tagalog
   syllabi) as a checklist only; all content is original.
3. **Content production:** build the roadmap unit by unit, native-reviewed in the Studio.
4. **Fluency extras:** spaced repetition, graded stories for reading/listening, role-play
   scenarios with Tala.
