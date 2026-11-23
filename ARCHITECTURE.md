# Architecture

Tagalingo is a single Next.js 16 (App Router) application backed by Postgres. There is no
separate API service: pages are React Server Components that read from Prisma, and every
mutation is a server action.

```
Browser ──► proxy.ts (session cookie check) ──► Server Components (pages) ──► src/server/* ──► Prisma ──► Postgres
   │                                                                              ▲
   └── client components (lesson player, studio controls) ──► server actions ─────┘
                                                              src/app/actions/*
```

## Module boundaries

| Path                            | Responsibility                                                                                                                      | May import                                                         |
| ------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------ |
| `src/lib/game/*`                | Pure game rules: grading, hearts, streaks, league week, unlock path, XP, goals. No I/O.                                             | `lib/grammar` (pure, for grading)                                  |
| `src/lib/content/*`             | Exercise schemas + lint, course loader, generators (Claude/stub), client-safe view, file⇄DB persistence                             | `lib/game`, `lib/grammar`, `lib/color`, `lib/random`, Prisma types |
| `src/lib/grammar/*`             | Pure grammar engine: verb morphology, word analysis, vocabulary and drill checks, the `verbs.json` file format, chat tokeniser      | `lib/content` (course types, helpers)                              |
| `src/lib/color.ts`, `random.ts` | Pure helpers: WCAG contrast and accessible avatar colours; seeded shuffles. No I/O.                                                 | nothing app-specific                                               |
| `src/lib/db.ts`, `env.ts`       | Lazy Prisma client, validated env with dev defaults                                                                                 | —                                                                  |
| `src/server/*`                  | Use-cases that combine rules with the database (`server-only`): lessons, path, grammar progress, learner stats, leaderboard, studio | `lib/*`                                                            |
| `src/app/actions/*`             | Server actions: validate input, re-check the session/role, call `src/server`, revalidate paths                                      | `server/*`, `lib/*`                                                |
| `src/app/**/page.tsx`           | Server-rendered screens                                                                                                             | `server/*`, components                                             |
| `src/components/*`              | Shared UI (Tala mascot, icons, buttons, stats widgets, navigation)                                                                  | `lib/*` types, `lib/color`                                         |
| `prisma/`, `scripts/`           | Schema, migrations, seed, content CLIs (plain Node; construct their own Prisma client)                                              | `lib/*`                                                            |

The rules in `src/lib/game` are deliberately pure functions with unit tests; everything that
touches the database is covered by integration tests (`*.int.test.ts`) and Playwright.

## Data model

See `prisma/schema.prisma` (commented) and PLAN.md. In short: `Course → Unit → Skill → Lesson →
Exercise`, with `Word` rows hanging off `Skill`. Learner state is `User` (hearts, streak, goal),
`LessonAttempt` + `AttemptAnswer` (one play-through), `LessonProgress` (unlocks), `XpEvent`
(leaderboard + history) and `DailyActivity` (per-day XP for the goal ring and calendar).

`Exercise.payload` is JSON whose shape depends on `Exercise.type`; it is always validated by
`parseExercise` (zod) when written _and_ when read.

Grammar adds `GrammarPattern` (a course.yaml pattern: its card as JSON and the one lesson that
teaches it), `ExercisePattern` (which patterns an exercise drills), `PatternProgress` (a learner's
attempts, strength and `seenAt` per pattern), `VerbTable` (the forms of one root with one affix,
with a review status) and `CardFlag` (a reviewer's note on a card). `LessonAttempt.patternId`
scopes a practice attempt to one pattern. Deleting a pattern cascades to all of these, learners'
pattern-practice attempts included.

## Lesson lifecycle

1. `/lesson/[id]` (server) checks the lesson is unlocked (`buildPath`) and sends **answer-free**
   exercise views (`toClientExercise`) to the client player.
2. The player calls `startLessonAction` → a `LessonAttempt` row (refused with 0 hearts).
3. Each Check calls `answerAction` → `gradeAnswer` on the server, an `AttemptAnswer` row, and a
   heart lost on a wrong answer (match-pairs is exempt). At 0 hearts the attempt is `FAILED`.
4. `submitAnswer` and `completeAttempt` first lock the learner's `User` row
   (`SELECT … FOR UPDATE`), so concurrent requests from two tabs can't lose a heart update or
   double-award the first-time bonus.
5. Wrong exercises are re-queued client-side; when the queue empties the player calls
   `completeLessonAction`, which verifies every exercise that was live when the attempt started
   has a correct answer, flips the
   attempt `IN_PROGRESS → COMPLETED` with a compare-and-swap (no double XP), and in one
   transaction awards XP, updates the streak, `DailyActivity` and `LessonProgress`.

## Practice, audio and chat (v1.1)

- **Snapshots:** every `LessonAttempt` stores `exerciseIds`, exactly what was served, so only
  those can be answered and completion requires each of them. `kind` is `LESSON` or `PRACTICE`;
  practice attempts are scoped to a skill or a unit, never cost hearts, give 5–10 XP and win back
  a heart.
- **Audio:** `SpeechProvider` (`src/lib/speech/provider.ts`) uses Google Cloud TTS when
  `GOOGLE_TTS_API_KEY` is set and is served through `/api/tts` (signed-in only, ≤200 characters,
  cached in memory). Without it, the client falls back to a browser Filipino voice, then to
  showing the text.
- **Speech recognition:** the browser's Web Speech API (`fil-PH`). Transcripts are graded on the
  server by normalised similarity (≥ 0.75). Skipping is always allowed and costs nothing.
- **Chat:** `ChatTutor` (`src/lib/chat/tutor.ts`): `ClaudeTutor` (forced tool call → reply,
  translation, optional correction and hint) or the offline `StubTutor`. The conversation stays in
  the browser; the server action only sees the last 12 turns.
- **Word lookup:** see [Grammar engine](#grammar-engine-v12) below.
- **Content:** `course.yaml` also holds emoji pictures (flashcard decoration only), hand-written dialogues (with wrong
  replies) and tips. They're synced into `Word.pic`, `Skill.dialogues` and `Skill.tips`.

## Grammar engine (v1.2)

Grammar content is authored in `course.yaml`, drafted by rules, reviewed in the Studio and loaded
from files, like exercises. Verb tables are the one piece of data the rest depends on, so they get
their own review step.

| Module                                           | Responsibility                                                                                                                                   |
| ------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------ |
| `lib/grammar/morphology.ts`                      | Draft the aspect forms of a root + affix from rules (15 affixes). Irregulars are `forms` overrides in `course.yaml`, fixed by review.            |
| `lib/grammar/analyse.ts`                         | `analyse`: which verb forms could a typed word be, against approved tables. `diffFromRule`: which cells a reviewer changed from the rules.       |
| `lib/grammar/vocab-check.ts`                     | `grammarVocabIssues`: every Tagalog word in a card or drill must be a course word taught by then, a `FUNCTION_WORDS` entry, or an approved form. |
| `lib/grammar/drill-check.ts`                     | `verbDrillIssues`: conjugate, paradigm and find_root drills must still match the approved tables.                                                |
| `lib/grammar/verbs-file.ts`                      | The `content/<lang>/grammar/verbs.json` format and its loaders (`readVerbFile`, `loadApprovedVerbs`); no database needed.                        |
| `lib/grammar/tokenize.ts`, `forms-input.ts`      | Split chat text into words and gaps; convert verb-table cells to and from the Studio's one-line-per-form text.                                   |
| `lib/content/grammar-schema.ts`                  | Zod schemas for `grammar` patterns, `verbs` and the stored card; `clientCard` drops `mistakes`.                                                  |
| `lib/content/grammar-persist.ts`                 | `syncGrammar`, `draftVerbTables`, `exportVerbTables`, `importVerbTables`, `loadApprovedVerbTables`.                                              |
| `lib/content/generators/grammar-drills.ts`       | Stub-only drills from pattern ingredients and approved tables; each passes `checkDrill` and is tagged with its pattern.                          |
| `lib/game/strength.ts`                           | Pure pattern strength: an EWMA of first answers, decayed on read (21-day half-life), and its label.                                              |
| `server/grammar.ts`                              | Unlock state, strength, the cards an attempt shows, weakest patterns, `lookupWords`.                                                             |
| `server/lessons.ts`                              | Grading context (approved tables, pattern `mistakes`), `PatternProgress` updates, `seenAt`, pattern and weak-grammar practice scopes.            |
| `server/studio.ts`                               | Verb-table review (`saveVerbTable`, `reviewVerbTable`), card flags, pattern tags, and `verbDrillIssues` as exercise warnings.                    |
| `components/player/steps.ts`, `grammar-card.tsx` | The player's step queue with cards interleaved; the card and the "?" chip. `grammar-exercises.tsx` holds the four new drill inputs.              |
| `components/verb-sheet.tsx`, `pattern-entry.tsx` | Verb tables, the tap-a-word sheet and tappable text; a pattern's card with strength and a practise link (grammar and skill pages).               |

### Data flows

```
course.yaml grammar ──syncGrammar──► GrammarPattern (card JSON, teaching lesson)
course.yaml verbs   ──grammar:draft──► VerbTable (DRAFT) ──/studio/verbs──► APPROVED ──content:export──► grammar/verbs.json
grammar/verbs.json  ──seed: importVerbTables──► VerbTable (APPROVED)
VerbTable (APPROVED) ──► stub generator (--grammar-only or Generate drafts) ──► DRAFT drills + ExercisePattern tags
```

- **Seed and sync.** `syncCourseStructure` mirrors `course.yaml`, ending with `syncGrammar`
  (patterns that disappear from it are deleted, with their progress, tags, flags and
  pattern-practice attempts).
  The seed then runs `importVerbTables`, which rejects any cell that differs from the rules unless
  the row lists it as `irregular`, so an unreviewed typo can't ship.
- **Drills come only from approved tables.** `generateDraftsForLesson` loads the course's
  `APPROVED` tables and hands them to the stub, which skips a drill whose verb has none. Claude
  produces vocabulary drills only. `--grammar-only` adds just the tagged drills after the lesson's
  4th exercise and skips any whose type and payload already exist in the lesson, in any status.
- **Review safety nets.** `getSkillForReview` adds `verbDrillIssues` to each exercise's warnings, and
  editing or un-approving a table tells the reviewer how many approved drills use it.
  `course.test.ts` runs the same check, the vocabulary check and the irregular-marking check
  against the shipped files in CI.
- **Player.** `startAttempt` and `startPractice` return the cards of the tagged patterns
  (`attemptGrammar`; new only in a lesson that teaches the pattern the learner hasn't unlocked) and
  an `exercisePatterns` map. `steps.ts` inserts each new card before the first exercise tagged with
  it and turns on a "?" chip for patterns already shown. Cards are sent through `clientCard`, so a
  pattern's `mistakes` stay on the server.
- **Grading.** Verb drills grade strictly against the table forms; `explain` names the form a wrong
  word actually is, then to the exercise's or pattern's `mistakes`, then a per-option `why`, then
  the find_root hint. Answers never reach the client: the four new types have `toClientExercise` cases and
  leak tests.
- **Progress.** On the first real answer to an exercise in an attempt, `submitAnswer` updates
  `PatternProgress` for each linked pattern inside the learner lock; `completeAttempt` sets `seenAt`
  for the patterns the lesson teaches. A pattern is unlocked when `seenAt` is set or its lesson is
  completed.
- **Word lookup.** `lookupWords` analyses words against the approved tables, grouped by table.
  `TagalogText` tokenises a line, makes one batch `lookupWordsAction` call and turns known verb
  forms into buttons that open a `VerbSheet`; unknown words and failed lookups stay plain text.
  It is used for Tala's chat lines only; the grammar page (`/grammar`) and skill pages show verb
  tables directly (`VerbTableView`). Returning full approved tables is a deliberate exception to
  answer secrecy: a learner may consult the verb reference as they would a textbook table, while
  drill payloads still never carry answers.

## Time-based rules

- **Hearts** are stored as `(hearts, heartsUpdatedAt)` and resolved lazily on read
  (`liveHearts`), so no cron job is needed.
- **Streaks** compare calendar days (`YYYY-MM-DD`) in the learner's IANA timezone.
- **League weeks** run Monday 00:00 UTC to Monday 00:00 UTC for everyone; the leaderboard is a
  `groupBy` over `XpEvent.createdAt`.

## Content pipeline

```
content/tagalog/course.yaml ─► ExerciseGenerator ─► DRAFT rows ─► /studio review ─► APPROVED ─► content:export ─► exercises/*.json ─► seed
                               (Claude | Stub)
```

- `ExerciseGenerator` is the only interface to a paid service. `ClaudeGenerator` forces a tool
  call whose JSON schema is derived from the zod schemas, then re-validates each item;
  `StubGenerator` builds every exercise type from the word list with ambiguity guards
  (no synonym distractors, different-POS fill-in-the-blank options, all synonyms accepted).
- For lessons that teach or use grammar patterns, `generateDraftsForLesson` passes the course's
  `APPROVED` verb tables to `StubGenerator`, which adds up to five grammar drills
  (`generators/grammar-drills.ts`) built from the patterns' drill ingredients and those tables.
  Each drill is tagged with its pattern (`ExercisePattern`) and must pass `checkDrill`: forms from
  an approved table, only words the lesson has taught, no answer in a hint. Failures are reported
  as `rejected`, never saved.
- `selectGenerator()` picks Claude when `ANTHROPIC_API_KEY` is set, otherwise the stub.
- Only `APPROVED` exercises are ever served. A lesson with none blocks the path ("in review").

## Verification

Answer secrecy is checked at three levels, from the narrowest to the whole app: unit tests on
`toClientExercise`, integration tests on what `startAttempt` / `startPractice` return, and an
end-to-end test that records the real network responses while a lesson and a practice session
load (`e2e/answer-secrecy.spec.ts`). Shipped content is validated without a database by
`checkShippedContent` (`src/lib/content/shipped.ts`), using the same rules the seed import
applies. Accessibility (axe-core, WCAG 2.2 AA), page-weight budgets and schema drift are gated in
CI; see "Continuous integration" in README.md.

## Auth

Auth.js v5, Credentials provider (bcrypt hashes), JWT sessions. `auth.config.ts` is DB-free and
used by `proxy.ts` for a cheap redirect; pages and actions call `requireUser()` /
`requireReviewer()`, which re-load the user from the database (a deleted user is signed out).
Reviewer rights go through `canReview()`: the public demo account is never a reviewer in
production unless `DEMO_CAN_REVIEW=true`.

## Technology choices

- **Next.js App Router + server actions** — one deployable, no hand-written API layer, and
  answers can be graded server-side without exposing them.
- **Postgres + Prisma 7** — relational data with real constraints (unique progress rows,
  transactions for XP); Prisma 7's driver adapter keeps the client lightweight.
- **Auth.js Credentials** — works offline with no provider accounts; OAuth can be added later.
- **Zod** — one schema per exercise type shared by generator, Studio, seed and grader.
- **Cache Components off** — every screen is per-learner; pages render dynamically and actions
  call `revalidatePath`.
