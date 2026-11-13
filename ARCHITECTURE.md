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

| Path                      | Responsibility                                                                                                                      | May import               |
| ------------------------- | ----------------------------------------------------------------------------------------------------------------------------------- | ------------------------ |
| `src/lib/game/*`          | Pure game rules: grading, hearts, streaks, league week, unlock path, XP, goals. No I/O.                                             | nothing app-specific     |
| `src/lib/content/*`       | Exercise schemas + lint, course loader, generators (Claude/stub), client-safe view, file⇄DB persistence                             | `lib/game`, Prisma types |
| `src/lib/db.ts`, `env.ts` | Lazy Prisma client, validated env with dev defaults                                                                                 | —                        |
| `src/server/*`            | Use-cases that combine rules with the database (`server-only`): lessons, path, grammar progress, learner stats, leaderboard, studio | `lib/*`                  |
| `src/app/actions/*`       | Server actions: validate input, re-check the session/role, call `src/server`, revalidate paths                                      | `server/*`, `lib/*`      |
| `src/app/**/page.tsx`     | Server-rendered screens                                                                                                             | `server/*`, components   |
| `src/components/*`        | Shared UI (Tala mascot, icons, buttons, stats widgets, navigation)                                                                  | `lib/*` types            |
| `prisma/`, `scripts/`     | Schema, migrations, seed, content CLIs (plain Node; construct their own Prisma client)                                              | `lib/*`                  |

The rules in `src/lib/game` are deliberately pure functions with unit tests; everything that
touches the database is covered by integration tests (`*.int.test.ts`) and Playwright.

## Data model

See `prisma/schema.prisma` (commented) and PLAN.md. In short: `Course → Unit → Skill → Lesson →
Exercise`, with `Word` rows hanging off `Skill`. Learner state is `User` (hearts, streak, goal),
`LessonAttempt` + `AttemptAnswer` (one play-through), `LessonProgress` (unlocks), `XpEvent`
(leaderboard + history) and `DailyActivity` (per-day XP for the goal ring and calendar).

`Exercise.payload` is JSON whose shape depends on `Exercise.type`; it is always validated by
`parseExercise` (zod) when written _and_ when read.

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
- **Content:** `course.yaml` also holds emoji pictures (flashcard decoration only), hand-written dialogues (with wrong
  replies) and tips. They're synced into `Word.pic`, `Skill.dialogues` and `Skill.tips`.

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
