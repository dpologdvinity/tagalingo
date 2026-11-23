# Contributing

## Local setup

```bash
npm install
npm run setup        # Postgres (Docker) + migrations + demo seed
npm run dev
```

Requirements: Node 24+, Docker. No accounts or `.env` are needed for development; see the
configuration table in README.md if you want to override defaults.

## Branches and commits

- Branch from `master` (`feat/…`, `fix/…`, `chore/…`) and open a pull request; CI must pass.
- Give the pull request a Conventional Commit title (a squash merge uses it as the commit message).
  CI labels it by area, posts screenshots of the key screens, and Claude leaves a review (plus a
  Tagalog review when `content/` changes). Comment `@claude …` to ask for changes or a re-review.
- Use [Conventional Commits](https://www.conventionalcommits.org/): `feat(scope): …`,
  `fix: …`, `test: …`, `docs: …`, `refactor: …`, `chore: …`. Keep commits small and atomic.

## Checks (all run in CI)

```bash
npm run format:check     # Prettier (npm run format to fix)
npm run lint             # ESLint
npm run typecheck        # tsc (run `npx next typegen` first after adding routes)
npm test                 # unit tests
npm run test:integration # needs the Docker database; uses a separate tagalingo_test DB
npm run content:check    # shipped content report (also covered by npm test)
npm run build && npm run test:e2e   # Playwright against a production server
```

The Playwright suite includes the core loop, axe-core accessibility scans (WCAG 2.2 AA) of every
screen, an answer-secrecy check on the network traffic, and JavaScript budgets per screen
(`e2e/performance.spec.ts`). If a change genuinely needs more JavaScript, raise that screen's
budget in the same PR and say why. CI also checks that `prisma/migrations` matches
`schema.prisma`, audits production dependencies, and enforces the coverage floor in
`vitest.config.ts`.

## Conventions

- Game rules belong in `src/lib/game` as pure, unit-tested functions. Write the failing test
  first, then the code.
- Database work goes in `src/server/*` (marked `server-only`); server actions in
  `src/app/actions/*` validate input and re-check the session before calling it.
- Never send exercise answers to the browser: use `toClientExercise`.
- Every exercise payload goes through `parseExercise`; add new exercise types there first.
- Schema changes: edit `prisma/schema.prisma`, then `npm run db:migrate -- --name <change>` and
  commit the migration.

## Content changes

Word lists live in `content/tagalog/course.yaml` (validated by `npm test`). After reviewing
exercises in `/studio`, run `npm run content:export` and commit `content/tagalog/exercises/*.json`.
Please have Tagalog content checked by a fluent speaker before approving it.

## Grammar content

Grammar lives in `course.yaml` beside the word lists: top-level `grammar` patterns (the card learners
read plus the drill ingredients), a `verbs:` list per skill, and `teaches:` / `uses:` pattern ids per
lesson. Each pattern is taught by exactly one lesson, and `requires` and `uses` never point forward.
`npm test` validates all of it, including the **vocabulary check**: every Tagalog word in a card or
drill must be a course word taught by then, a `FUNCTION_WORDS` entry (`src/lib/grammar/vocab-check.ts`;
extend it only by commit, with a comment saying why) or a name. An inflected verb form counts as known
only if it is in an approved table in `grammar/verbs.json`.

**Adding a verb**

1. Add it under the skill's `verbs:` in `course.yaml` (`root`, `en`, `affixes`, and `glottal` / `stem`
   where the root needs them; see the comment at the top of the file).
2. `npm run grammar:draft` creates a DRAFT table for every verb and affix that has none. Existing tables
   are never touched, so it is safe to re-run.
3. Review each table in `/studio/verbs`: correct a wrong cell (a comma separates accepted spellings;
   the first is canonical), save, then approve. A cell that differs from the engine's rule output is
   marked irregular automatically. Please have a fluent speaker check the forms.
4. `npm run content:export` writes the approved tables to `content/tagalog/grammar/verbs.json`.
   Commit it. `npm test` fails when a row differs from the rules without being marked irregular, and
   the seed refuses the same.

`content:export` refuses to empty a non-empty `verbs.json` when the database has no approved tables
(almost always the wrong `DATABASE_URL`); pass `-- --force` only if you mean it. It also refuses,
naming each row, an approved table the seed would reject: one whose verb or affix course.yaml no
longer lists, or whose form differs from the rules without being marked irregular.

**Grammar drills**

```bash
CONTENT_GENERATOR=stub npm run content:generate -- --skill <slug> --grammar-only
```

This adds only the tagged grammar drills, as DRAFTs, after each lesson's 4th exercise, and leaves the
lesson's existing exercises (approved ones too) alone. Drills are built from the patterns' ingredients
and **approved** verb tables only, up to 5 per lesson. It is idempotent by exact payload: a drill whose
type and payload already exist in the lesson, in any status, is skipped. The catch: a reseed loads only
what was exported, and rejected drills are not exported, so after a reseed a re-run recreates them as
drafts. To get rid of an unwanted drill for good, delete it rather than reject it. The Claude generator
produces no grammar drills.

Review the drills in `/studio/skills/…`: each exercise shows its pattern tags, and a verb drill that no
longer matches the approved tables carries a warning. After correcting a table, check those warnings
and fix or delete the drills they name.

**Renaming a pattern.** Pattern ids are keys. Renaming or removing one in `course.yaml` deletes the old
pattern on the next sync (the seed, `content:generate` and `grammar:draft` each run one) and cascades to
its `PatternProgress`, its exercise tags, its card flags **and the learners' pattern-practice attempts**
(`LessonAttempt.patternId`). Exported exercise files list pattern ids in `patterns`, so update them in
the same commit.
