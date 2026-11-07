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

| Path                      | Responsibility                                                                                                    | May import               |
| ------------------------- | ----------------------------------------------------------------------------------------------------------------- | ------------------------ |
| `src/lib/game/*`          | Pure game rules: grading, hearts, streaks, league week, unlock path, XP, goals. No I/O.                           | nothing app-specific     |
| `src/lib/content/*`       | Exercise schemas + lint, course loader, generators (Claude/stub), client-safe view, file⇄DB persistence           | `lib/game`, Prisma types |
| `src/lib/db.ts`, `env.ts` | Lazy Prisma client, validated env with dev defaults                                                               | —                        |
| `src/server/*`            | Use-cases that combine rules with the database (`server-only`): lessons, path, learner stats, leaderboard, studio | `lib/*`                  |
| `src/app/actions/*`       | Server actions: validate input, re-check the session/role, call `src/server`, revalidate paths                    | `server/*`, `lib/*`      |
| `src/app/**/page.tsx`     | Server-rendered screens                                                                                           | `server/*`, components   |
| `src/components/*`        | Shared UI (Tala mascot, icons, buttons, stats widgets, navigation)                                                | `lib/*` types            |
| `prisma/`, `scripts/`     | Schema, migrations, seed, content CLIs (plain Node; construct their own Prisma client)                            | `lib/*`                  |

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
4. Wrong exercises are re-queued client-side; when the queue empties the player calls
   `completeLessonAction`, which verifies every exercise has a correct answer, flips the
   attempt `IN_PROGRESS → COMPLETED` with a compare-and-swap (no double XP), and in one
   transaction awards XP, updates the streak, `DailyActivity` and `LessonProgress`.

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
  `StubGenerator` builds the same five exercise types from the word list with ambiguity guards
  (no synonym distractors, different-POS fill-in-the-blank options, all synonyms accepted).
- `selectGenerator()` picks Claude when `ANTHROPIC_API_KEY` is set, otherwise the stub.
- Only `APPROVED` exercises are ever served. A lesson with none blocks the path ("in review").

## Auth

Auth.js v5, Credentials provider (bcrypt hashes), JWT sessions. `auth.config.ts` is DB-free and
used by `proxy.ts` for a cheap redirect; pages and actions call `requireUser()` /
`requireReviewer()`, which re-load the user from the database (a deleted user is signed out).

## Technology choices

- **Next.js App Router + server actions** — one deployable, no hand-written API layer, and
  answers can be graded server-side without exposing them.
- **Postgres + Prisma 7** — relational data with real constraints (unique progress rows,
  transactions for XP); Prisma 7's driver adapter keeps the client lightweight.
- **Auth.js Credentials** — works offline with no provider accounts; OAuth can be added later.
- **Zod** — one schema per exercise type shared by generator, Studio, seed and grader.
- **Cache Components off** — every screen is per-learner; pages render dynamically and actions
  call `revalidatePath`.
