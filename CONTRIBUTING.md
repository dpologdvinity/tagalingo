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

- Branch from `main` (`feat/…`, `fix/…`, `chore/…`) and open a pull request; CI must pass.
- Use [Conventional Commits](https://www.conventionalcommits.org/): `feat(scope): …`,
  `fix: …`, `test: …`, `docs: …`, `refactor: …`, `chore: …`. Keep commits small and atomic.

## Checks (all run in CI)

```bash
npm run format:check     # Prettier (npm run format to fix)
npm run lint             # ESLint
npm run typecheck        # tsc (run `npx next typegen` first after adding routes)
npm test                 # unit tests
npm run test:integration # needs the Docker database; uses a separate tagalingo_test DB
npm run build && npm run test:e2e   # Playwright against a production server
```

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
