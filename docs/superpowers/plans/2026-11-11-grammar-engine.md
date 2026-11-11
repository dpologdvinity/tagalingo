# Grammar Engine Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Teach Tagalog grammar as tracked patterns: cards in lessons, grammar drills, verb tables, per-learner strength, grammar practice, and native-review tooling; retrofit Units 1–4.

**Architecture:** Grammar patterns and verbs are authored in `course.yaml`, validated at load, synced to Postgres, and referenced by lessons. A pure morphology engine in `src/lib/grammar/` drafts verb tables that are reviewed (Studio) and exported to `content/tagalog/grammar/verbs.json`; drills only use approved tables. Four new exercise types plus explanation feedback go through the existing parse → client-view → grade pipeline; `PatternProgress` is updated inside the existing per-learner lock.

**Tech Stack:** Next.js 16 (App Router, server actions, typed routes), Prisma 7 (`@/generated/prisma/client`), zod, Vitest, Playwright, Tailwind.

**Spec:** `docs/superpowers/specs/2026-11-11-grammar-engine-design.md`

## Global Constraints

- Exercise answers never reach the client; every new type goes through `toClientExercise` and gets a leak test.
- Every exercise payload goes through `parseExercise`; new types are added there first.
- Game rules are pure, unit-tested functions in `src/lib/game` (strength) / `src/lib/grammar` (morphology); write the failing test first.
- Schema changes: edit `prisma/schema.prisma`, create a migration under `prisma/migrations/`, commit it. (`migrate dev` is non-interactive-hostile here: write SQL via `npx prisma migrate diff --from-config-datasource --to-schema prisma/schema.prisma --script`.)
- Drills use only `APPROVED` verb tables, never raw engine output.
- Morphology answers are strict: no Levenshtein typo tolerance for `conjugate`, `find_root` (typed), `paradigm`.
- Strength: `strength += 0.3 × (r − strength)`; effective = `strength × 0.5^(days/21)`; labels New (0 attempts) · Learning (< 0.6) · Solid (< 0.9) · Mastered (≥ 0.9 and ≥ 8 attempts). Only the first answer per (attempt, exercise) counts; speak skips don't count.
- `seenAt` is set only on LESSON completion, for that lesson's `teaches`.
- All content is original, written in session; review note on AI-reviewed content: `AI-reviewed during build (Claude); awaiting native-speaker review.`
- `ClaudeGenerator` is not extended for grammar.
- Conventional Commits; stage files explicitly (never `git add -A`); no absolute home paths in files.
- Verification before each commit: `npm run format:check && npm run lint && npm run typecheck && npm test`; tasks touching DB also `npm run test:integration`; UI tasks also `npm run build && npm run test:e2e` (with `AUTH_SECRET`, `DEMO_CAN_REVIEW=true`, `DATABASE_URL=postgresql://tagalingo:tagalingo@localhost:5433/tagalingo` exported).

## Review Focus

1. **Learners who finished lessons before the retrofit** (the demo account, the owner): patterns taught by already-completed lessons must count as unlocked on the grammar page and in practice, even though `seenAt` is null. → Task 10 test `treats patterns of completed lessons as unlocked`.
2. **Hyphen, case and accent variants in typed morphology** (`Mag-aaral`, `magaaral`, `nag-aral`): accepted via `normalizeAnswer` while one-letter aspect differences (`kumain`/`kakain`) are still rejected. → Task 6 test `strict morphology still normalises case and hyphens`.
3. **Weak-grammar practice with nothing eligible** (new learner, or < 3 attempts everywhere): friendly error, button disabled, no crash. → Task 10 test `weakGrammar with no eligible patterns throws LessonError("not_found")`, Task 12 renders disabled button.
4. **"?" chip for a pattern whose card was never shown** (tagged via `uses`, learner skipped the teaching lesson pre-retrofit): start returns card data for every tagged pattern, not only new ones. → Task 10 test `returns card data for all tagged patterns, isNew only for unseen taught ones`.
5. **Word lookup on an unknown or ambiguous word** (chat message words, names, particles): sheet shows nothing for unknown words, all candidates for ambiguous ones (e.g. `kumain` = -um- infinitive and completed). → Task 2 test `analyse returns every matching cell`, Task 12 e2e covers unknown → no sheet.

---

## File Structure

| File                                                                                                    | Responsibility                                                                                    |
| ------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------- |
| `src/lib/grammar/types.ts`                                                                              | `Affix`, `VerbForm`, `FormTable`, `VerbEntry`, `VerbTableData` types and constants                |
| `src/lib/grammar/morphology.ts`                                                                         | `conjugate()` + morphophonemic helpers                                                            |
| `src/lib/grammar/analyse.ts`                                                                            | `analyse()`, `diffFromRule()`                                                                     |
| `src/lib/grammar/vocab-check.ts`                                                                        | `unknownWords()` known-vocabulary check for grammar content                                       |
| `src/lib/grammar/morphology.test.ts`, `analyse.test.ts`, `vocab-check.test.ts`                          | fixtures                                                                                          |
| `src/lib/content/grammar-schema.ts`                                                                     | zod schemas for `grammar:` patterns, `verbs:`, drill ingredients; course-level grammar validation |
| `src/lib/content/course.ts`                                                                             | wire grammar schema into course; `lessonRequest` grammar context                                  |
| `src/lib/content/schema.ts`                                                                             | four new exercise types; `why` / `mistakes` fields; lint                                          |
| `src/lib/content/client-view.ts`                                                                        | client views for new types                                                                        |
| `src/lib/game/grading.ts`                                                                               | grading for new types, `GradeContext`, `explanation`                                              |
| `src/lib/game/strength.ts`                                                                              | strength maths and labels                                                                         |
| `src/lib/content/generators/grammar-drills.ts`                                                          | stub grammar slots + automatic checks                                                             |
| `src/lib/content/generators/stub.ts`                                                                    | call grammar slots                                                                                |
| `src/lib/content/grammar-persist.ts`                                                                    | sync patterns/verbs/tags; verb draft, export, import                                              |
| `src/lib/content/persist.ts`                                                                            | export/import carry `patterns: string[]` per exercise                                             |
| `prisma/schema.prisma` + migration `*_grammar_engine`                                                   | models from spec §2                                                                               |
| `scripts/draft-verbs.ts`                                                                                | `npm run grammar:draft`                                                                           |
| `src/server/grammar.ts`                                                                                 | grammar page data, pattern unlock logic, word lookup                                              |
| `src/server/lessons.ts`                                                                                 | cards in start, grade context, PatternProgress, seenAt, practice scopes                           |
| `src/components/player/grammar-card.tsx`                                                                | card view + "?" chip modal                                                                        |
| `src/components/player/grammar-exercises.tsx`                                                           | `Conjugate`, `FindRoot`, `Transform`, `Paradigm`                                                  |
| `src/components/verb-sheet.tsx`                                                                         | word lookup sheet + `VerbTableView`                                                               |
| `src/app/(app)/grammar/page.tsx`                                                                        | grammar page                                                                                      |
| `src/app/(app)/studio/verbs/…`, `studio/grammar/…`                                                      | Studio verb grid, grammar tab, card flags                                                         |
| `content/tagalog/course.yaml`, `content/tagalog/grammar/verbs.json`, `content/tagalog/exercises/*.json` | retrofit content                                                                                  |

---

### Task 1: Morphology engine — `conjugate()`

**Files:**

- Create: `src/lib/grammar/types.ts`, `src/lib/grammar/morphology.ts`, `src/lib/grammar/morphology.test.ts`

**Interfaces:**

- Produces:
  - `type Affix = "um" | "mag" | "ma" | "mang" | "maka" | "makapag" | "magpa" | "maki" | "in" | "i" | "an" | "ipag" | "ipang" | "pa_in" | "ma_obj"`; `const AFFIXES: readonly Affix[]`
  - `type VerbForm = "infinitive" | "completed" | "incompleted" | "contemplated" | "recent"`; `const VERB_FORMS`
  - `type FormTable = { infinitive: string[]; completed: string[]; incompleted: string[]; contemplated: string[]; recent?: string[] }` (index 0 canonical, rest accepted variants)
  - `type VerbEntry = { root: string; en: string; affixes: Affix[]; glottal: boolean; stem: string | null; forms: Partial<Record<Affix, Partial<Record<VerbForm, string[]>>>> }`
  - `const FORM_LABEL: Record<VerbForm, { en: string; tl: string }>` = infinitive `{en:"infinitive / command", tl:"pawatas"}`, completed `{en:"past", tl:"perpektibo"}`, incompleted `{en:"present", tl:"imperpektibo"}`, contemplated `{en:"future", tl:"kontemplatibo"}`, recent `{en:"just did", tl:"katatapos"}`
  - `conjugate(verb: VerbEntry, affix: Affix): FormTable` — rule output, then `verb.forms[affix]` overrides replace whole cells.
  - Helpers exported for tests: `reduplicate(root: string): string` (CV copy: `kain→kakain`, `inom→iinom`, `luto→luluto`), `infixUm(word)`, `infixIn(word)` (l/y/w-initial → `ni` prefix), `suffix(verb, "in" | "an")` (glottal/-h-, o→u raising, d→r, `stem`), `nasalise(root)` for mang-.

- [ ] **Step 1: Write the failing fixture test** `describe.each` over a fixture array `[root-entry, affix, expected FormTable]` containing at least every cell of the spec §3 table, plus:
  - vowel-initial: `inom/um → uminom, uminom, umiinom, iinom, recent kaiinom`; `aral/mag → mag-aral, nag-aral, nag-aaral, mag-aaral` (recent not asserted for vowel-initial mag- roots)
  - l-initial: `linis/in → linisin, nilinis, nililinis|linilinis, lilinisin`
  - glottal flag: `basa/in (glottal:false) → basahin, binasa, binabasa, babasahin`; `luto/in (glottal:true) → lutuin, niluto, niluluto, lulutuin`
  - syncope: `bili/in (stem:"bilh") → bilhin, binili, binibili, bibilhin`; `dala/in (stem:"dalh") → dalhin, dinala, dinadala, dadalhin`
  - override: `kuha/in` with `forms.in.infinitive: ["kunin"]`, `contemplated: ["kukunin"]` → those values, other cells by rule (`kinuha, kinukuha`)
  - o→u: `inom/in → inumin, ininom, iniinom, iinumin`
  - d→r: `bayad/an → bayaran, binayaran, binabayaran, babayaran`
  - mang- assimilation: `bili→mamili`, `nood→manood`, `isda→mangisda`, `kuha→manguha`
  - maka- variants: `kain/maka → makakain, nakakain, [nakakakain, nakakain], makakakain`
  - `recent` present only for `um`, `mag`, `ma`: `kain/um → kakakain`, `luto/mag → [kaluluto, kakaluto]`, `tulog/ma → [katutulog, kakatulog]`

  ```ts
  it.each(FIXTURES)("%s + %s", (verb, affix, expected) => {
    expect(conjugate(verb, affix)).toEqual(expected);
  });
  ```

- [ ] **Step 2: Run** `npx vitest run src/lib/grammar/morphology.test.ts` — Expected: FAIL (module not found).
- [ ] **Step 3: Implement** `types.ts` and `morphology.ts` to the interfaces above. Consonant-final prefixes (`mag`, `nag`, `pag`, `ipag`, `ipinag`, `makapag`, `nakapag`, `ipang`) take a hyphen before vowel-initial roots. mang- assimilation: p/b → `mam` + drop initial; t/d/s → `man` + drop; k → `mang` + drop; vowel/other → `mang` (+ hyphen-less for vowels). Each helper gets a doc comment naming the rule.
- [ ] **Step 4: Run** the test — Expected: PASS. Then full verification line from Global Constraints.
- [ ] **Step 5: Commit** `git add src/lib/grammar && git commit -m "feat(grammar): verb morphology engine"`

### Task 2: `analyse()` and `diffFromRule()`

**Files:**

- Create: `src/lib/grammar/analyse.ts`, `src/lib/grammar/analyse.test.ts`

**Interfaces:**

- Consumes: Task 1 types, `conjugate`, and `normalizeAnswer` from `@/lib/game/grading`.
- Produces:
  - `type VerbTableData = { root: string; affix: Affix; en: string; forms: FormTable }`
  - `type Analysis = { root: string; affix: Affix; en: string; form: VerbForm; canonical: string }`
  - `analyse(word: string, tables: readonly VerbTableData[]): Analysis[]` — every (table, form) cell whose canonical or variant matches `normalizeAnswer(word)`.
  - `diffFromRule(verb: VerbEntry, affix: Affix, reviewed: FormTable): VerbForm[]` — forms whose reviewed array differs from `conjugate()` output.

- [ ] **Step 1: Failing tests:**
  - `analyse returns every matching cell`: with the `kain/um` table, `analyse("kumain")` has length 2 (`infinitive`, `completed`); `analyse("Kumakain")` → one, form `incompleted`.
  - `analyse finds variants`: `nakakain` matches `maka` completed and incompleted (variant).
  - `analyse returns [] for unknown words`: `analyse("salamat")` → `[]`.
  - `diffFromRule flags changed cells only`: reviewed `kuha/in` with `infinitive:["kunin"]` → `["infinitive"]`; identical table → `[]`.
- [ ] **Step 2: Run** `npx vitest run src/lib/grammar/analyse.test.ts` — FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** — PASS; full verification.
- [ ] **Step 5: Commit** `feat(grammar): analyse inflected verbs and diff reviewed tables`

### Task 3: Course format — patterns, verbs, teaches/uses, drill ingredients

**Files:**

- Create: `src/lib/content/grammar-schema.ts`, `src/lib/content/grammar-schema.test.ts`
- Modify: `src/lib/content/course.ts` (courseSchema gains `grammar`; lessons gain `teaches`, `uses`; skills gain `verbs`; `GenerationRequest` + `lessonRequest`)
- Test: `src/lib/content/course.test.ts`

**Interfaces:**

- Consumes: Task 1 `Affix`, `VerbForm`, `AFFIXES`, `VERB_FORMS`.
- Produces:
  - `patternSchema` → `type CoursePattern = { id; title; rule; table?: { head: string[]; rows: string[][] }; examples: [string, string][] (2–3); notes: string[]; mistakes: [string, string][]; requires: string[]; drills: { frames: Frame[]; transforms: Transform[]; choices: Choice[] } }`
    - `Frame = [sentence: string (exactly one "___"), en: string, affix: Affix, form: VerbForm, root?: string]` — root omitted means "any approved verb with that affix in the lesson".
    - `Transform = [source, sourceEn, instruction, answers: string[]]`
    - `Choice = [sentence (one "___"), en, options: string[] (2–4), answerIndex, why: (string | null)[] (same length; null at answerIndex)]`
  - `verbEntrySchema` → `VerbEntry` (yaml keys: `root`, `en`, `affixes`, `glottal` default false, `stem` default null, `forms` default {}).
  - Lesson: `{ title; words; teaches: string[] = []; uses: string[] = [] }`; Skill: `verbs: VerbEntry[] = []`.
  - `GenerationRequest` gains `grammar: { teaches: CoursePattern[]; uses: CoursePattern[]; verbs: VerbEntry[] /* this skill + earlier skills */; knownWords: string[] /* course words up to and including this lesson */ }`.
  - `lessonRequest(course: CourseDefinition, skill: CourseSkill, lessonIndex: number): GenerationRequest` — **signature change**: course first; update all call sites (`persist.ts`, `scripts/*`, generator tests).

- [ ] **Step 1: Failing tests** (each rejects a minimal broken course built from the existing `minimal` fixture):
  - `rejects a pattern taught by two lessons` → `/taught by more than one lesson/`
  - `rejects a pattern no lesson teaches` → `/not taught/`
  - `rejects teaches/uses of an unknown pattern` → `/unknown pattern/`
  - `rejects requires or uses pointing at a later pattern` → `/later/`
  - `rejects a mistake identical to an example sentence` → `/mistake/`
  - `rejects a frame without exactly one blank` and `a choice whose why has text at the answer index`
  - `rejects a verb affix outside AFFIXES` and `an override naming an unknown form`
  - `lessonRequest exposes teaches, uses, cumulative verbs and known words` (two-skill fixture: skill 2 lesson 1 knows skill 1 words and its own lesson-1 words, not lesson-2 words)
  - `the shipped course still loads` (existing test keeps passing).
- [ ] **Step 2: Run** `npx vitest run src/lib/content` — FAIL.
- [ ] **Step 3: Implement** schemas in `grammar-schema.ts`; course-level checks in a `courseSchema.superRefine` that walks units → skills → lessons in order to compute teach order.
- [ ] **Step 4: Run** — PASS; full verification.
- [ ] **Step 5: Commit** `feat(content): grammar patterns, verbs and lesson teaches/uses in course.yaml`

### Task 4: Known-vocabulary check for grammar content

(The spec lists this under load-time validation; it needs `verbs.json`, so it runs as a unit test over the shipped course instead — same CI gate.)

**Files:**

- Create: `src/lib/grammar/vocab-check.ts`, `src/lib/grammar/vocab-check.test.ts`
- Modify: `src/lib/content/course.test.ts` (shipped-content test)

**Interfaces:**

- Consumes: `CourseDefinition`, Task 2 `analyse`, `VerbTableData`.
- Produces:
  - `FUNCTION_WORDS: ReadonlySet<string>` — `ang ng sa si ni kay mga ay ko mo ka ba na pa po opo naman lang at may wala hindi huwag din rin daw raw nga ito iyan iyon dito diyan doon ako ikaw siya kami tayo kayo sila akin iyo kanya amin atin inyo kanila niya namin natin ninyo nila kita` (the spec's list plus pronoun/demonstrative sets; extended only by commit with a comment).
  - `unknownWords(sentence: string, known: ReadonlySet<string>, tables: readonly VerbTableData[]): string[]` — tokens (lower-cased, punctuation stripped, hyphenated `taga-X` split) not in `known`, not in `FUNCTION_WORDS`, not capitalised mid-sentence (names), and not an inflected form of an approved table (`analyse(token).length > 0`).
  - `grammarVocabIssues(course: CourseDefinition, tables: readonly VerbTableData[]): string[]` — for each pattern: examples, table cells, frames, transforms (source + answers), choices; known set = words up to and including the teaching lesson (multi-word `tl` entries split into tokens).
- [ ] **Step 1: Failing tests:** `unknownWords("Kumain ako ng isda.", {"isda"}, [kain/um]) → []`; `unknownWords("Uminom ako ng gatas.", {"isda"}, [kain/um]) → ["uminom","gatas"]`; names `"Kumain si Ana."` → `[]`; `grammarVocabIssues` on a fixture where a lesson-1 pattern example uses a lesson-2 word reports `/pattern um-aspect example 1: "…" uses unknown "…"/`.
- [ ] **Step 2: Run** — FAIL. **Step 3: Implement.** **Step 4: Run** — PASS.
- [ ] **Step 5:** add to `course.test.ts`: `shipped grammar content uses only known words` → `expect(grammarVocabIssues(course, loadApprovedVerbs())).toEqual([])` where `loadApprovedVerbs()` reads `content/tagalog/grammar/verbs.json` (returns `[]` if absent). Commit `feat(grammar): known-vocabulary check for grammar content`.

### Task 5: New exercise types — schema, lint, client views

**Files:**

- Modify: `src/lib/content/schema.ts`, `src/lib/content/client-view.ts`
- Test: `src/lib/content/schema.test.ts`, `src/lib/content/client-view.test.ts`

**Interfaces:**

- Consumes: Task 1 `AFFIXES`, `VERB_FORMS`.
- Produces (`EXERCISE_TYPES` gains `conjugate`, `find_root`, `transform`, `paradigm`):
  - `conjugate`: `{ sentence (exactly one "___"), translation, root, affix: Affix, form: VerbForm, answers: string[] (≥1) }` → client `{ id, type, sentence, translation, root, affix, form }`
  - `find_root`: `{ word, translation?: string, mode: "choice" | "type", options?: string[] (2–4, required iff choice, must include root), root, hint }` → client `{ id, type, word, translation?, mode, options? }`
  - `transform`: `{ source, sourceEn, instruction, mode: "build" | "type", answers: string[][] (≥1 token sequence), distractors: string[] = [] }` → client `{ id, type, source, sourceEn, instruction, mode, tiles? }` where `tiles` (build mode only) = shuffle(answers[0] ∪ distractors) with the exercise id as seed (use `@/lib/random` like `word_bank`).
  - `paradigm`: `{ root, affix, en, cells: { form: VerbForm; value: string; hidden: boolean }[] (≥2 hidden ≥1), distractors: string[] }` → client `{ id, type, root, affix, en, cells: { form; value: string | null }[], tiles }` (hidden values → `null`; tiles = hidden values ∪ distractors shuffled).
  - Optional `why: (string | null)[]` on `select_translation`, `fill_blank`, `listen_select`, `dialogue` (refine: same length as options, null at `answerIndex`); never sent to the client.
  - Optional `mistakes: { answer: string; why: string }[]` on `word_bank`, `type_translation`, `conjugate`, `transform`; never sent to the client.
  - Lint: `conjugate` warns when `answers[0]` appears in `sentence` or `translation`; `transform` warns when `source` equals an answer; `paradigm` warns on duplicate tiles.
- [ ] **Step 1: Failing tests:** parse accept/reject for each new type (blank count, options must contain root, why length/null-at-answer, hidden-cell count); lint warnings above; **leak tests**: for each new type and for `fill_blank` with `why`, `JSON.stringify(toClientExercise(...))` does not contain any answer string, `why` text or `mistakes` text.
- [ ] **Step 2: Run** `npx vitest run src/lib/content` — FAIL. **Step 3: Implement.** Add placeholder branches for the new types in `exercise-preview.tsx`, `scripts/preview-content.ts` and `e2e/helpers.ts` only if `tsc` requires exhaustiveness (real UI in Tasks 11, 13). **Step 4: Run** — PASS; full verification.
- [ ] **Step 5: Commit** `feat(content): conjugate, find_root, transform and paradigm exercise types`

### Task 6: Grading and explained feedback

**Files:**

- Modify: `src/lib/game/grading.ts`; Test: `src/lib/game/grading.test.ts`

**Interfaces:**

- Consumes: Task 2 `analyse`, `VerbTableData`; Task 5 payloads.
- Produces:
  - `type GradeContext = { verbTables?: readonly VerbTableData[]; patternMistakes?: readonly [string, string][] }`
  - `gradeAnswer(ex: ParsedExercise, answer: unknown, ctx: GradeContext = {}): GradeResult`
  - `GradeResult.explanation?: string`; `GradeResult.wrongCells?: VerbForm[]` (paradigm).
  - Answer shapes: `conjugate {text}`, `find_root {choice}|{text}`, `transform {tokens}|{text}`, `paradigm {cells: Record<VerbForm, string>}`.
  - Explanation precedence (spec §4): wrong form of same verb → known mistake (exercise `mistakes`, then `ctx.patternMistakes`) → per-option `why` → none.
  - Wrong-form copy, exact: `` `That's the ${FORM_LABEL[f].en} form (${canonical}). The ${FORM_LABEL[target].en} is ${answers[0]}.` ``
  - `find_root` wrong → `explanation = hint`.
- [ ] **Step 1: Failing tests:**
  - `conjugate is strict`: answers `["kakain"]`, `{text:"kakain"}` correct, `{text:"kakan"}` wrong (no typo).
  - `strict morphology still normalises case and hyphens`: answers `["mag-aaral"]` accepts `"Mag-aaral"` and `"magaaral"`; answers `["kumain"]` rejects `"kakain"`.
  - `conjugate names the wrong form`: ctx tables `[kain/um]`, target contemplated, `{text:"kumakain"}` → explanation `"That's the present form (kumakain). The future is kakain."`
  - `known mistakes explain`: exercise mistakes `[{answer:"Kain ako.", why:"…-um-…"}]` on `type_translation`; and `ctx.patternMistakes` used when the exercise has none.
  - `per-option why`: `fill_blank` with `why` → choosing index 1 returns its `why`.
  - `paradigm lists wrong cells`: two hidden cells, one wrong → `correct:false, wrongCells:["contemplated"]`.
  - `transform accepts any listed sequence` in both modes.
  - `find_root` choice + typed, wrong → explanation = hint.
- [ ] **Step 2: Run** `npx vitest run src/lib/game/grading.test.ts` — FAIL. **Step 3: Implement.** **Step 4: Run** — PASS; full verification.
- [ ] **Step 5: Commit** `feat(grading): grade grammar drills with explained feedback`

### Task 7: Strength maths

**Files:**

- Create: `src/lib/game/strength.ts`, `src/lib/game/strength.test.ts`

**Interfaces:**

- Produces: `STRENGTH = { alpha: 0.3, halfLifeDays: 21 } as const`; `updateStrength(s: number, correct: boolean): number`; `effectiveStrength(s: number, lastPracticedAt: Date | null, now: Date): number`; `type StrengthLabel = "new" | "learning" | "solid" | "mastered"`; `strengthLabel(effective: number, attempts: number): StrengthLabel`.
- [ ] **Step 1: Failing tests:** six `updateStrength(…, true)` from 0 → `≈ 0.882` (toBeCloseTo 3) and label `solid`; one miss from 0.882 → `≈ 0.617`; `effectiveStrength(0.8, 21 days ago) ≈ 0.4`; null `lastPracticedAt` → `s`; labels: 0 attempts → `new` regardless; 0.59 → `learning`; 0.9 with 7 attempts → `solid`; 0.9 with 8 → `mastered`.
- [ ] **Steps 2–4:** run FAIL → implement → PASS. **Step 5: Commit** `feat(game): pattern strength with time decay`

### Task 8: Database models, migration, sync, verb export/import

**Files:**

- Modify: `prisma/schema.prisma`; Create: `prisma/migrations/<timestamp>_grammar_engine/migration.sql`
- Create: `src/lib/content/grammar-persist.ts`, `src/lib/content/grammar-persist.int.test.ts`, `scripts/draft-verbs.ts`
- Modify: `src/lib/content/persist.ts` (export/import `patterns: string[]`), `prisma/seed.ts`, `scripts/export-content.ts`, `package.json` (`"grammar:draft": "tsx scripts/draft-verbs.ts"`)

**Interfaces:**

- Consumes: Tasks 1–3.
- Produces:
  - Prisma models exactly as spec §2 (`GrammarPattern`, `ExercisePattern`, `PatternProgress`, `VerbTable`, `CardFlag`, enum `VerbAffix`), with relations: `GrammarPattern.course/lesson`, `ExercisePattern.exercise/pattern`, `PatternProgress.user/pattern`, `CardFlag.pattern/user`, all `onDelete: Cascade`; `@@index([patternId])` on `ExercisePattern` and `PatternProgress`. `LessonAttempt` gains `patternId String?` (relation to `GrammarPattern`, cascade) and `weakGrammar Boolean @default(false)`. Card JSON shape = `CoursePattern` minus `id`, `requires`, `drills`.
  - `syncGrammar(prisma, def: CourseDefinition): Promise<void>` — upsert patterns by `(courseId, slug)` with `order` = course order and `lessonId`; delete patterns no longer in yaml. Called from `syncCourseStructure`.
  - `draftVerbTables(prisma, def): Promise<{ created: number; unchanged: number }>` — for each skill verb × affix, create a `DRAFT` `VerbTable` from `conjugate()` unless an APPROVED/DRAFT row exists.
  - `exportVerbTables(prisma, contentDir)` → `content/tagalog/grammar/verbs.json` = `{ verbs: { root, affix, en, forms, irregular, reviewNote }[] }` sorted by root, affix (APPROVED only).
  - `importVerbTables(prisma, contentDir, reviewedById?)` → upsert as APPROVED; throws if a form differs from rule and is not listed in `irregular` (uses `diffFromRule`).
  - `loadApprovedVerbs(contentDir?): VerbTableData[]` (file-only, no DB; used by tests and Task 4).
  - Exercise export entries gain `patterns: string[]` (default `[]` on import); import recreates `ExercisePattern` rows by slug.
- [ ] **Step 1: Failing integration tests** (`tagalingo_test`): `syncGrammar upserts and removes patterns`; `exercise export/import round-trips pattern tags`; `verb export/import round-trips`; `import rejects an unmarked irregular form`; `draftVerbTables skips existing rows`.
- [ ] **Step 2:** edit schema; generate migration SQL with `prisma migrate diff`; apply with `npx prisma migrate deploy`; `npx prisma generate`.
- [ ] **Step 3: Run** `npm run test:integration` — new tests FAIL (functions missing). **Step 4: Implement**; seed calls `syncGrammar` and `importVerbTables` before importing exercises. **Step 5: Run** — PASS; full verification incl. `SEED_FORCE=1 npm run db:seed`.
- [ ] **Step 6: Commit** `feat(db): grammar patterns, verb tables and pattern progress`

### Task 9: Stub generator grammar slots and automatic checks

**Files:**

- Create: `src/lib/content/generators/grammar-drills.ts`; Modify: `src/lib/content/generators/stub.ts`, `src/lib/content/generators/types.ts`, `src/lib/content/persist.ts` (`generateDraftsForLesson` passes approved tables and writes `ExercisePattern` rows)
- Test: `src/lib/content/generators/generators.test.ts`

**Interfaces:**

- Consumes: Task 3 `GenerationRequest.grammar`, Task 4 `unknownWords`, Task 5 types, Task 8 `loadApprovedVerbs`.
- Produces:
  - `GenerationResult.exercises` items become `{ type, payload, patterns: string[] }` (`TaggedExercise`); vocabulary drills get `patterns: []`.
  - `buildGrammarDrills(req: GenerationRequest, tables: readonly VerbTableData[], rand: () => number): { drills: TaggedExercise[]; rejected: { raw: unknown; reason: string }[] }` — per taught pattern in order: 1 `fill_blank` from `choices` (with `why`), 1 `conjugate` per frame (root = frame root or first lesson verb with that affix; answers = approved cell array), 1 `transform` (build mode, distractors from same-verb other forms), 1 `find_root` for `roots`/`find-the-root`, 1 `paradigm` (hide 2 cells) for verb patterns; `uses` patterns contribute at most 1 drill. Cap: 5 drills per lesson.
  - `checkDrill(d: TaggedExercise, req, tables): string | null` — reason when: morphology answer not in an approved table cell; tags ⊄ teaches ∪ uses; `unknownWords` non-empty; hint/instruction contains an answer.
  - `StubGenerator.generate(req, tables = [])` inserts grammar drills after the recipe's first 4 exercises (recognition first, production later).
  - `ClaudeGenerator` untouched except for satisfying the `TaggedExercise` return shape (`patterns: []`).
- [ ] **Step 1: Failing tests:** `adds tagged grammar drills to lessons that teach a pattern` (fixture lesson teaching `um-aspect` with approved `kain/um`: ≥1 `conjugate` whose answers equal the table cell, tagged `["um-aspect"]`); `rejects a conjugate drill whose answer is not in an approved table` (corrupted table → rejected with `/approved verb table/`); `rejects drills using unknown words`; `never more than 5 grammar drills`; `lessons without teaches/uses are unchanged` (deep-equal to previous output for a vocabulary-only lesson); determinism test still passes.
- [ ] **Steps 2–4:** FAIL → implement → PASS; full verification + `npm run test:integration`.
- [ ] **Step 5: Commit** `feat(generator): grammar drills from reviewed verb tables`

### Task 10: Server — cards, grading context, progress, practice scopes

**Files:**

- Modify: `src/server/lessons.ts`, `src/app/actions/lesson.ts` (`practiceScope` zod), `src/app/practice/page.tsx` (`?pattern=<slug>` and `?weak=grammar`)
- Create: `src/server/grammar.ts`
- Test: `src/server/lessons.int.test.ts`, `src/server/grammar.int.test.ts`

**Interfaces:**

- Consumes: Tasks 6–8.
- Produces:
  - `type LessonCard = { slug: string; title: string; card: PatternCard; isNew: boolean }` (`PatternCard` = card JSON type exported from `grammar-persist.ts`).
  - `StartedAttempt = { attemptId; exercises: ClientExercise[]; cards: LessonCard[]; exercisePatterns: Record<string, string[]> }` — `cards` covers every pattern tagged on a served exercise; `isNew` = lesson attempt, pattern in the lesson's teaches, not unlocked for the user.
  - `PracticeScope = { skillId } | { unitId } | { patternSlug: string } | { weakGrammar: true }`.
  - `submitAnswer`: builds `GradeContext` (for `conjugate`/`paradigm`/`find_root`: APPROVED tables for the root; pattern mistakes of linked patterns); returns `AnswerFeedback` + `explanation: string | null` + `wrongCells: VerbForm[] | null`; on the first answer for (attempt, exercise), non-skipped, upserts `PatternProgress` for each linked pattern with `updateStrength`, inside the existing transaction/lock.
  - `completeAttempt`: LESSON → set `seenAt = now` where null for lesson's teaches.
  - `src/server/grammar.ts`: `isUnlocked(progress: { seenAt } | undefined, teachingLessonCompleted: boolean): boolean`; `getGrammarOverview(userId, now): Promise<GrammarOverviewItem[]>` (`{ slug, title, order, unlocked, card | null (null when locked), label: StrengthLabel, effective: number, skillTitle }`); `weakestPatterns(userId, now, n = 3): Promise<string[]>` (unlocked, attempts ≥ 3, lowest effective); `lookupWord(word: string): Promise<Analysis[]>` (APPROVED tables).
- [ ] **Step 1: Failing integration tests:**
  - `returns card data for all tagged patterns, isNew only for unseen taught ones`
  - `first answer only updates PatternProgress` (wrong then correct on the same exercise → attempts 1, correct 0)
  - `speak skips do not touch PatternProgress`
  - `seenAt is set on lesson completion, not on start or quit`
  - `treats patterns of completed lessons as unlocked` (completed lesson, no PatternProgress row → `unlocked: true`)
  - `pattern practice serves only tagged exercises from finished lessons` (≤ 10)
  - `weakGrammar picks the lowest effective strengths with ≥ 3 attempts`
  - `weakGrammar with no eligible patterns throws LessonError("not_found")`
  - `conjugate feedback names the wrong form` end-to-end through `submitAnswer`
- [ ] **Steps 2–4:** FAIL → implement → PASS (`npm run test:integration`); full verification.
- [ ] **Step 5: Commit** `feat(lessons): grammar cards, pattern progress and grammar practice`

### Task 11: Player — grammar drills, cards, "?" chip, explanations

**Files:**

- Create: `src/components/player/grammar-exercises.tsx`, `src/components/player/grammar-card.tsx`
- Modify: `src/components/player/lesson-player.tsx` (steps = cards interleaved; chip; feedback `explanation`, paradigm wrong cells), `src/components/player/exercises.tsx` (shared `Instruction`, `PromptBubble`, `Options` exports if not already exported), `e2e/helpers.ts` (`answerCurrent` handles the four new types; skips cards by clicking "Got it")

**Interfaces:**

- Consumes: Task 5 client views, Task 10 `StartedAttempt`.
- Produces: `Conjugate`, `FindRoot`, `Transform`, `Paradigm` components with the existing `Props<T>` shape (`exercise`, `disabled`, `onChange`); `GrammarCardView({ card, onDone })`; `PatternChip({ cards })` (opens modal with the card; `aria-label="Grammar help: <title>"`).
- Copy (exact): conjugate instruction `` `Make it ${FORM_LABEL[form].en}` `` with root shown as `(root)` after the blank; find_root `"What's the root?"`; paradigm `"Fill in the verb table"`; card button `"Got it — let's try"`.
- Cards are steps: the player queue becomes `Step = { kind: "card"; card } | { kind: "exercise"; exercise }`, card inserted before the first exercise tagged with each `isNew` card; card steps don't submit, don't affect progress bar denominator beyond +1 step, and never re-queue.
- Keyboard: number keys select options/tiles as in existing components; Enter submits.
- [ ] **Step 1:** add Playwright tests to `e2e/core-loop.spec.ts` (fail now): `a grammar card appears once and the chip reopens it` (fresh learner, Mga Pandiwa lesson 1 unlocked via SQL fixture `update`: insert `LessonProgress` for earlier lessons; card heading visible; finish lesson; replay → no card; chip opens card), `conjugate feedback names the wrong form`.
- [ ] **Step 2: Implement** components and queue change. **Step 3:** `npm run build && npm run test:e2e` — Expected: 22 + new tests pass (needs Task 14 content for real lessons; until then use a seeded fixture lesson created in the test via SQL, or run this step after Task 14 — **run after Task 14** and keep the commit for this task UI-only with unit-level checks: `npm run typecheck && npm run lint`).
- [ ] **Step 4: Commit** `feat(player): grammar cards, help chip and grammar drills`

### Task 12: Grammar page, skill-page section, path placard, word lookup

**Files:**

- Create: `src/app/(app)/grammar/page.tsx`, `src/components/verb-sheet.tsx`, `src/app/actions/grammar.ts` (`lookupWordAction(word: string): Promise<{ table: VerbTableData; analyses: Analysis[] }[]>`, grouped by table)
- Modify: `src/app/(app)/skills/[slug]/page.tsx` + `src/server/course.ts` (`SkillPageData.patterns`, `SkillPageData.verbTables`), `src/app/(app)/learn/skill-path.tsx` + `PathView` (pattern titles per skill), `src/components/app-nav.tsx` (Grammar nav item), `src/app/(app)/chat/chat-room.tsx` (Tagalog words in Tala's messages tappable → verb sheet when lookup non-empty), run `npx next typegen`

**Interfaces:**

- Consumes: Task 10 `getGrammarOverview`, `weakestPatterns`, `lookupWord`.
- Produces: `/grammar` route; `VerbTableView({ table })` (root column first, columns infinitive/past/present/future/just did with Tagalog names in a smaller second line, variants after a slash, speaker buttons per cell); `VerbSheet({ word })`.
- Copy: page heading `"Grammar"`; weak button `"Practise your weakest grammar"` (disabled with helper text `"Answer a few grammar drills first."` when `weakestPatterns` is empty); per-pattern `"Practise this"` → `/practice?pattern=<slug>`; locked rows show title + `"Unlocks in <skill title>"`.
- [ ] **Step 1:** e2e tests (fail): `the grammar page lists unlocked patterns and practises one` (demo account), `tapping a verb in Tala's reply shows its table; unknown words show nothing`.
- [ ] **Step 2: Implement.** **Step 3:** typecheck/lint; e2e after Task 14. **Step 4: Commit** `feat(ui): grammar page, skill grammar section and verb lookup`

### Task 13: Studio — verb grid, grammar tab, card flags

**Files:**

- Create: `src/app/(app)/studio/verbs/page.tsx`, `src/app/(app)/studio/verbs/verb-grid.tsx`, `src/app/(app)/studio/grammar/page.tsx`, `src/app/(app)/studio/grammar/flag-form.tsx`
- Modify: `src/server/studio.ts`, `src/app/actions/studio.ts`, `src/app/(app)/studio/page.tsx` (links), `src/app/(app)/studio/skills/[skillId]/exercise-preview.tsx` (four new types + `why` + pattern tags with edit), `scripts/preview-content.ts`

**Interfaces:**

- Consumes: Task 8 models, Task 2 `diffFromRule`.
- Produces actions (all `requireReviewer`): `saveVerbTableAction(id: string, formsJson: string): Promise<StudioResult>` (validates shape; recomputes `irregular` via `diffFromRule`); `reviewVerbTableAction(id, status: "APPROVED" | "REJECTED", note?)`; `flagCardAction(patternSlug, note)`; `resolveFlagAction(flagId)`; `setExercisePatternsAction(exerciseId, slugs: string[])` (slugs must exist).
- Grid: one row per root × affix, five form columns, editable inputs (comma = variants), irregular cells highlighted with "differs from rule", Approve / Reject, status badge.
- [ ] **Step 1:** integration tests in `src/server/studio.int.test.ts` (fail): save recomputes irregular; regular learner gets `notFound` behaviour (action returns `{ok:false}`); flags list open/resolved. e2e: `the studio verb grid approves a table` (demo reviewer).
- [ ] **Steps 2–3:** implement → integration PASS. **Step 4: Commit** `feat(studio): verb table review, grammar cards and flags`

### Task 14: Retrofit content for Units 1–4

**Files:**

- Modify: `content/tagalog/course.yaml`; Create: `content/tagalog/grammar/verbs.json`; Modify: `content/tagalog/exercises/*.json`

**Content (spec §7 table), pattern ids:** `po-opo`, `ako-ka-siya`, `kami-tayo`, `predicate-first`, `ng-object`, `si-names`, `linkers`, `nasa-nasaan-saan`, `ba-questions`, `taga`, `roots`, `um-aspect`, `mag-aspect`, `find-the-root`, `commands-mo-paki`. Each: rule, examples (2–3), mistakes (≥1), drills (≥2 choices with `why`; verb patterns ≥3 frames and ≥2 transforms). Verbs: every verb word in the course gets a `verbs:` entry (Mga Pandiwa, Biyahe's `kumaliwa/kumanan`, Sa Bahay commands, any `pos: verb`).

- [ ] **Step 1:** write patterns + `teaches`/`uses` + verbs in `course.yaml`; `npm test` (Task 3/4 validators) — PASS.
- [ ] **Step 2:** `npm run grammar:draft`; review every draft table by hand against the spec §3 rules (Claude Code), fix overrides in yaml, approve via Studio action or script with the AI-review note; `npm run content:export` → `verbs.json`.
- [ ] **Step 3:** tag existing approved exercises that already test a pattern (e.g. `ng` fill-blanks → `ng-object`, `ba` word banks → `ba-questions`) via `patterns` in the exported JSON.
- [ ] **Step 4:** generate grammar drills for each lesson with teaches/uses (`npm run content:generate -- --grammar-only`: add this flag to `scripts/generate-content.ts`, which keeps existing approved exercises and adds grammar DRAFTs); review each with `npx tsx scripts/preview-content.ts`; approve with the AI-review note; export.
- [ ] **Step 5:** `SEED_FORCE=1 npm run db:seed`; full verification incl. integration; `npm run build && npm run test:e2e` — all tests from Tasks 11–13 now PASS.
- [ ] **Step 6: Commits** (separate): `content(grammar): patterns and cards for Units 1–4`, `content(grammar): reviewed verb tables`, `content(grammar): grammar drills for Units 1–4`.

### Task 15: Code review, docs, owner steps

**Files:**

- Modify: `README.md`, `ARCHITECTURE.md`, `PLAN.md` (v1.2 section), `CONTRIBUTING.md` (`grammar:draft`, verbs.json workflow), `docs/agents/STEPS-FOR-OWNER.md` (native review: cards, verb tables — spec §3 table first — and grammar drills; Studio paths).
- [ ] **Step 1:** run `superpowers:requesting-code-review` on the branch range; fix all critical/important findings with tests.
- [ ] **Step 2:** update docs; `npm run format:check`.
- [ ] **Step 3:** full verification (format, lint, typecheck, unit, integration, build, e2e); push; confirm CI green with `gh run list --limit 1`.
- [ ] **Step 4: Commit** `docs: grammar engine` (+ review-fix commits).
