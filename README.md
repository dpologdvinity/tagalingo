# Tagalingo

Learn Tagalog (Filipino) five minutes at a time. Tagalingo is a gamified language-learning
web app for English speakers: short lessons of mixed exercises, a daily streak and XP goal, a
weekly leaderboard (the _Barkada League_), a skill path that unlocks in order, and hearts that
refill over time. The mascot is Tala, a Philippine tarsier.

Lesson content is generated from a hand-written word list — by Claude when an API key is set,
or by an offline template generator otherwise — and every exercise is **reviewed by hand** in
the built-in content Studio before learners ever see it.

## What's in version 1

- **Lessons:** 8–12 exercises mixing five types: pick the meaning, fill in the blank, build a
  sentence from word tiles, match pairs, and type the translation. Typed answers forgive case,
  punctuation, accents and a single typo. Mistakes come back at the end of the lesson.
- **Streaks and daily goals:** the streak counts calendar days in your own timezone. Pick a goal
  of 10, 20, 30 or 50 XP per day.
- **XP and a weekly leaderboard:** everyone's XP since Monday 00:00 UTC, ranked.
- **Skill path:** 3 units and 8 skills; stops unlock in order. Skills whose content is still in
  review show as locked until it's approved.
- **Hearts:** 5 maximum. A wrong answer costs one, and one comes back every 30 minutes.
- **Content Studio** (`/studio`, reviewers only): generate drafts, preview each exercise as a
  learner sees it with lint warnings, then edit, approve or reject.

See [PLAN.md](PLAN.md) for the data model, screens and what's deliberately left out, and
[ARCHITECTURE.md](ARCHITECTURE.md) for how it fits together.

## Prerequisites

- Node.js 24+ and npm
- Docker (for the local Postgres) — or any Postgres 15+ you point `DATABASE_URL` at

No third-party accounts are needed to run it.

## Quick start

```bash
npm install
npm run setup     # starts Postgres in Docker, applies migrations, seeds the course + demo data
npm run dev       # http://localhost:3000
```

Click **Try the demo account** on the login page (or sign in with `demo@tagalingo.app` /
`tagalingo-demo`). The demo learner has a 7-day streak, some finished skills, a place on the
leaderboard, and reviewer access to the Studio.

`npm run db:seed` resets the database to the demo state at any time.

## Configuration

Everything has a working local default, so no `.env` file is required for development. To
override, create `.env` (it's git-ignored) with any of:

| Variable               | Required in production | Default (dev only)                                          | Purpose                                                                                  |
| ---------------------- | ---------------------- | ----------------------------------------------------------- | ---------------------------------------------------------------------------------------- |
| `DATABASE_URL`         | yes                    | `postgresql://tagalingo:tagalingo@localhost:5433/tagalingo` | Postgres connection string                                                               |
| `AUTH_SECRET`          | yes                    | a fixed dev secret (refused in production)                  | Signs session cookies. `npx auth secret`                                                 |
| `AUTH_TRUST_HOST`      | behind a proxy         | `true` is set in code                                       | Auth.js host trust                                                                       |
| `ANTHROPIC_API_KEY`    | no                     | unset                                                       | Enables Claude for draft generation                                                      |
| `CONTENT_GENERATOR`    | no                     | `claude` if a key is set, else `stub`                       | Force `stub` or `claude`                                                                 |
| `ANTHROPIC_MODEL`      | no                     | `claude-sonnet-5-5`                                         | Model used for drafts                                                                    |
| `HEART_REFILL_MINUTES` | no                     | `30`                                                        | Minutes per heart                                                                        |
| `DEMO_CAN_REVIEW`      | no                     | demo is a reviewer outside production                       | Set `true` to let the public demo account use the Studio in production (not recommended) |

## Writing lesson content

1. Edit the word list in [`content/tagalog/course.yaml`](content/tagalog/course.yaml): each word
   has a gloss, accepted synonyms, a part of speech and one example sentence pair.
2. Generate drafts — from the Studio ("Generate drafts") or the CLI:
   ```bash
   npm run content:generate -- --skill mga-kulay            # every lesson in the skill
   CONTENT_GENERATOR=claude ANTHROPIC_API_KEY=sk-... npm run content:generate -- --skill mga-kulay --lesson 1
   npx tsx scripts/preview-content.ts mga-kulay             # what the stub would produce, no DB
   ```
3. Review in `/studio`: approve, reject (with a note) or edit each draft. Only approved
   exercises reach learners.
4. `npm run content:export` writes approved exercises to `content/tagalog/exercises/*.json`.
   Commit those files; the seed loads them on every machine.

## Scripts

| Command                      | What it does                                                |
| ---------------------------- | ----------------------------------------------------------- |
| `npm run dev`                | Dev server                                                  |
| `npm run build` / `start`    | Production build / server                                   |
| `npm run setup`              | Postgres up + migrate + seed                                |
| `npm run db:seed`            | Reset to demo data                                          |
| `npm run lint`               | ESLint                                                      |
| `npm run typecheck`          | TypeScript                                                  |
| `npm test`                   | Unit tests (Vitest)                                         |
| `npm run test:integration`   | Server tests on a real Postgres (`tagalingo_test` database) |
| `npm run test:e2e`           | Playwright, desktop + mobile, against `next start`          |
| `npm run content:generate`   | Draft exercises from the word list                          |
| `npm run content:export`     | Save approved exercises to the repo                         |
| `npm run user:make-reviewer` | Give an account Studio access (`-- --email …`)              |

## Deploying

Any Node host plus managed Postgres works. A straightforward setup:

1. Create a Postgres database (Neon, Supabase, Railway, RDS…) and copy its connection string.
2. Import the repo into Vercel (or Render, Railway, Fly). Set `DATABASE_URL` and `AUTH_SECRET`
   (and optionally `ANTHROPIC_API_KEY`).
3. Build command `npm run build`; run migrations on deploy with `npx prisma migrate deploy`
   (on Vercel, prefix the build command: `npx prisma migrate deploy && npm run build`).
4. Load the course once: `SEED_DEMO_DATA=false DATABASE_URL=... npm run db:seed` (content
   only, no demo learners). Sign up in the app, then make yourself a reviewer:
   `DATABASE_URL=... npm run user:make-reviewer -- --email you@example.org`. The seed refuses
   to run once real accounts exist, so it can't wipe production by accident.

CI (GitHub Actions) runs lint, typecheck, unit, integration and end-to-end tests on every push
and pull request to `master`. Pushing a `v*` tag drafts a GitHub release.

## Content status

The shipped exercises for Units 1–2 were generated from the word list and reviewed by Claude
during the initial build; **they still need a review by a native Tagalog speaker**. Unit 3 is
left as drafts on purpose so the Studio review queue has real work in it.
