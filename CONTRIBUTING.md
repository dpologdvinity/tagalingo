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
