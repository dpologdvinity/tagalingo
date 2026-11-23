# Tagalingo

[![CI](https://github.com/dpologdvinity/tagalingo/actions/workflows/ci.yml/badge.svg?branch=master)](https://github.com/dpologdvinity/tagalingo/actions/workflows/ci.yml)
[![CodeQL](https://github.com/dpologdvinity/tagalingo/actions/workflows/codeql.yml/badge.svg?branch=master)](https://github.com/dpologdvinity/tagalingo/actions/workflows/codeql.yml)
[![WCAG 2.2 AA](https://img.shields.io/badge/WCAG_2.2-AA_checked_in_CI-0f8287)](e2e/accessibility.spec.ts)
[![Node 24](https://img.shields.io/badge/node-24-339933?logo=node.js&logoColor=white)](package.json)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue)](LICENSE)

Learn Tagalog (Filipino) five minutes at a time. Tagalingo is a gamified language-learning
web app for English speakers: short lessons of mixed exercises, a daily streak and XP goal, a
weekly leaderboard (the _Barkada League_), a skill path that unlocks in order, and hearts that
refill over time. The mascot is Tala, a Philippine tarsier.

Lesson content is generated from a hand-written word list — by Claude when an API key is set,
or by an offline template generator otherwise — and every exercise is **reviewed by hand** in
the built-in content Studio before learners ever see it. Verb forms come from a rule-based
morphology engine, and every verb table is reviewed by hand before a drill may use it.

## What's in version 1

- **Lessons:** 8–12 exercises mixing five types: pick the meaning, fill in the blank, build a
  sentence from word tiles, match pairs, and type the translation. Typed answers forgive case,
  punctuation, accents and a single typo. Mistakes come back at the end of the lesson.
- **Streaks and daily goals:** the streak counts calendar days in your own timezone. Pick a goal
  of 10, 20, 30 or 50 XP per day.
- **XP and a weekly leaderboard:** everyone's XP since Monday 00:00 UTC, ranked.
- **Skill path:** 4 units and 13 skills; stops unlock in order. Skills whose content is still in
  review show as locked until it's approved.
- **Hearts:** 5 maximum. A wrong answer costs one, and one comes back every 30 minutes.
- **Content Studio** (`/studio`, reviewers only): generate drafts, preview each exercise as a
  learner sees it with lint warnings, then edit, approve or reject. Grammar has its own review
  pages (see [Reviewing grammar](#reviewing-grammar)).

### Added in 1.1: richer lessons

- **Eight exercise types:** the five above plus **listening** (hear it, pick the meaning),
  **speaking** (graded by speech recognition, with a no-penalty "Can't speak now") and
  **dialogues** (choose the next line of a conversation). There is no picture exercise: emoji
  can be read more than one way, so they only decorate flashcards, next to the meaning.
- **Audio everywhere:** speaker buttons on Tagalog text. Google Cloud TTS is used if
  `GOOGLE_TTS_API_KEY` is set; otherwise the browser's own Filipino voice, or the text is shown.
- **Practice:** review any finished skill, or a whole unit. It works with 0 hearts, never costs
  hearts, and wins one back.
- **Skill pages:** original grammar tips, flip-card flashcards with audio, and the skill's
  conversations to read.
- **"Sounds of Tagalog"** pronunciation guide, linked from the first unit.
- **Chat with Tala:** a beginner conversation partner, using Claude with a key or an offline
  scripted tutor without one.

### Added in 1.2: the grammar engine

Grammar is taught and drilled, not only noted. 15 patterns (po and opo, the pronouns, ng objects,
linkers, nasa/nasaan/saan, ba-questions, how um- and mag- verbs change with aspect and more) each
have a short card, and 18 verb tables list each verb's forms by aspect.

- **Grammar cards in lessons:** the lesson that teaches a pattern opens its first drill with a
  card: the rule, a table and examples. It isn't graded and costs no hearts. You see each card
  once; a lesson you quit halfway leaves it unseen. Later lessons that only reuse the pattern show
  just the **?** chip.
- **"?" help chip:** every exercise on a pattern you've seen has a small **?** that reopens its
  card without affecting your answer.
- **Four new drill types:** _conjugate_ (fill the verb in a sentence), _find the root_, _transform_
  a sentence (build or type the changed version) and _paradigm_ (complete a verb table; the
  current course doesn't use it yet). Verb answers are strict: only the listed forms count, with
  no typo forgiveness. A wrong answer says why, for example "That's the past form (kumain). The future is kakain."
- **Grammar page** (`/grammar`): every pattern in course order with its card, a strength meter
  (new, learning, solid or mastered) and a **Practise this** button, plus **Practise your weakest
  grammar** at the top. Strength rises with correct first answers and fades about 21 days after
  you last practised, so the meter shows what you'd still remember. Patterns unlock when you
  finish the lesson that teaches them; locked ones show only where they unlock.
- **Skill pages:** a Grammar section with the skill's pattern cards and, once you've finished the
  lesson that drills them, its verb tables. The learning path lists the patterns each skill
  teaches.
- **Word lookup in chat:** verb forms in Tala's replies are underlined. Tap one for its root,
  affix and full verb table. Only verbs with a reviewed table are underlined.

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
| `GOOGLE_TTS_API_KEY`   | no                     | unset (browser voices)                                      | Server-side Tagalog audio via Google Cloud TTS                                           |
| `CHAT_TUTOR`           | no                     | `claude` if a key is set, else `stub`                       | Force the Chat with Tala tutor                                                           |
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
4. `npm run content:export` writes approved exercises to `content/tagalog/exercises/*.json` and
   approved verb tables to `content/tagalog/grammar/verbs.json`. Commit those files; the seed
   loads them on every machine. It refuses to empty a non-empty `verbs.json` when the database has
   no approved tables (usually the wrong `DATABASE_URL`); `-- --force` overrides that.

### Grammar content

Grammar patterns (cards and drill ingredients), each skill's `verbs:` and each lesson's
`teaches:` / `uses:` live in `course.yaml` too. Verb tables are drafted from the engine's rules:

```bash
npm run grammar:draft                                    # draft a table for every verb x affix that has none
CONTENT_GENERATOR=stub npm run content:generate -- --skill pagkain --grammar-only   # add only the grammar drills
```

`--grammar-only` keeps the lesson's existing exercises and adds the new grammar drills as drafts;
run it again and nothing is duplicated. Drills are built from the stub generator and only from
_approved_ verb tables, so review the tables first. The Claude generator writes vocabulary
drills only. [CONTRIBUTING.md](CONTRIBUTING.md) has the full workflow.

### Reviewing grammar

- `/studio/verbs`: one card per verb and affix. Correct any wrong cell (a comma separates accepted
  spellings; the first is the one learners see), then approve or reject. Learners only ever see
  approved tables.
- `/studio/grammar`: every grammar card as learners read it, a **Flag a problem** note on each
  and the open flags gathered at the top. Card text is fixed in `course.yaml` with a normal commit.
- `/studio/skills/…`: each exercise shows its pattern tags (editable) and warnings. Verb drills
  are re-checked against the approved tables, so correcting a table warns on any drill that no
  longer matches.

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
| `npm run content:generate`   | Draft exercises from the word list (`-- --grammar-only`)    |
| `npm run content:export`     | Save approved exercises and verb tables to the repo         |
| `npm run content:check`      | Validate the shipped content and print a report             |
| `npm run grammar:draft`      | Draft verb tables from the course's `verbs:` for review     |
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

## Continuous integration

Every push and pull request to `master` runs the full pipeline in GitHub Actions. Most checks
test something specific to Tagalingo:

| Check                       | What it guards                                                                                                   |
| --------------------------- | ---------------------------------------------------------------------------------------------------------------- |
| Lint, typecheck, unit tests | Prettier, ESLint, TypeScript, Vitest with a coverage floor on `src/lib`                                          |
| Course content              | Every shipped exercise parses and belongs to a real skill and lesson; the run summary shows exercises per skill  |
| Dependencies                | `npm audit` on production deps, Dependabot (grouped, minor/patch auto-merged), dependency review on PRs          |
| Schema drift                | The committed migrations produce exactly `schema.prisma`                                                         |
| Integration + end-to-end    | Server tests on Postgres; Playwright on desktop and mobile against a production build                            |
| Answer secrecy              | Records what the browser receives when a lesson or practice session starts and fails if any answer is in it      |
| Accessibility               | axe-core scans every screen, a lesson and its feedback panel against WCAG 2.2 AA                                 |
| Page weight                 | A JavaScript budget per key screen, with a table in the run summary                                              |
| Screenshots                 | Key screens on desktop and mobile, posted as one comment on each pull request                                    |
| CodeQL, actionlint          | Code scanning (weekly too) and linting of the workflows themselves                                               |
| PR hygiene                  | Conventional Commit titles, area labels from the files changed                                                   |
| Claude reviews              | A code review on new PRs, a Tagalog language review on content PRs, and `@claude` on issues and PRs (owner only) |

Pushing a `v*` tag drafts a GitHub release.

## Content status

The shipped exercises for Units 1–3 (274 of them, 47 of which are grammar drills), plus the
dialogues, tips, pronunciation guide, 15 grammar cards and 18 verb tables, were written or
generated during the build and reviewed by Claude only. **They still need a review by a native
Tagalog speaker.** Unit 4 (Sa Palengke) is left as drafts on purpose so the
Studio review queue has real work in it. All lesson content is original to Tagalingo.
