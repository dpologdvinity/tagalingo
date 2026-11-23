<!-- BEGIN:nextjs-agent-rules -->

## This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->

# Tagalingo — instructions for coding agents

This is the single source of truth for agent instructions. `CLAUDE.md` only imports it, so
Claude Code, Codex and other agents all read the same rules.

Tagalingo is a gamified web app for learning Tagalog from English (Next.js 16, Prisma 7,
Postgres, Auth.js). Read [PLAN.md](PLAN.md) (scope, data model, what's left out) and
[ARCHITECTURE.md](ARCHITECTURE.md) (module boundaries) before changing structure.

## Setup and commands

Node 24+ and Docker. No `.env` or third-party accounts are needed for development.

```bash
npm install
npm run setup            # Postgres in Docker (port 5433) + migrations + demo seed
npm run dev
```

Verify before claiming a task is done:

```bash
npm run format:check && npm run lint && npm run typecheck && npm test
npm run content:check                  # shipped-content report (npm test covers it too)
npm run test:integration               # needs the Docker DB; uses a separate tagalingo_test DB
npm run build && npm run test:e2e      # for UI changes; needs the environment below
```

The e2e suite is more than the core loop: axe-core WCAG 2.2 AA scans of every screen
(`accessibility.spec.ts`), answer secrecy checked on the network (`answer-secrecy.spec.ts`) and
JavaScript budgets per screen (`performance.spec.ts`). `screenshots.spec.ts` only runs when
`SCREENSHOTS_DIR` is set.

`next start` runs in production mode, so e2e needs a real `AUTH_SECRET`, an explicit
`DATABASE_URL` (the helpers read answers from it too) and `DEMO_CAN_REVIEW=true` for the Studio
tests; CI sets the same. If the owner's dev server holds port 3000 or you shouldn't touch their
data, use your own port and database, and drop the database when you're done:

```bash
docker exec tagalingo-db-1 createdb -U tagalingo tagalingo_mytask
export DATABASE_URL=postgresql://tagalingo:tagalingo@localhost:5433/tagalingo_mytask \
  AUTH_SECRET="$(openssl rand -base64 32)" DEMO_CAN_REVIEW=true CONTENT_GENERATOR=stub \
  PORT=3100 E2E_BASE_URL=http://localhost:3100
npx prisma migrate deploy && npm run db:seed && npm run build && npm run test:e2e
```

## Framework notes

- **Next.js 16:** middleware is `src/proxy.ts`; `params`, `searchParams` and `cookies()` are
  async; typed routes are on, so run `npx next typegen` after adding a route.
- **Prisma 7:** the client is generated to `src/generated/prisma` (import from
  `@/generated/prisma/client`) and the datasource URL lives in `prisma.config.ts`. App code uses
  the lazy `db` from `@/lib/db`; scripts and the seed create their own client, because
  `server-only` modules can't run in plain Node.

## Conventions

- **Exercise answers must never reach the client.** Grading happens in `src/server/lessons.ts`;
  send exercises to the browser only through `toClientExercise`. One deliberate exception: verb
  lookup (`lookupWordsAction` / `lookupWordAction`) returns full approved verb tables, because it is
  reference use, like a textbook table, and chat is meant to work as a dictionary. Drill payloads
  still never carry answers.
- Game rules live in `src/lib/game` as pure, unit-tested functions. Write the failing test first.
- Every exercise payload goes through `parseExercise`; add new exercise types there first.
- Schema changes: edit `prisma/schema.prisma`, run `npm run db:migrate -- --name <change>`, and
  commit the migration.
- Commits follow [Conventional Commits](https://www.conventionalcommits.org/) and stay small and
  atomic. Stage files explicitly rather than with `git add -A`.
- **Accessibility is gated.** Text on a coloured fill needs 4.5:1 contrast (3:1 only for truly
  large text). Use the design tokens in `globals.css`, `avatarColor` for generated colours, and
  unit colours that pass the `course.yaml` contrast rule. Fix violations at the source; never
  exclude elements or disable axe rules.
- **When you add a screen,** add it to `accessibility.spec.ts`, to `performance.spec.ts` with a
  budget about 15% above its measured size, and to `screenshots.spec.ts` if reviewers should see it.
- **When you add an exercise type,** also add its public fields (`publicValues`) and secret fields
  (`withheld`) to `answer-secrecy.spec.ts`. Keep `publicValues` written out by hand: deriving it
  from `toClientExercise` would let a leak whitelist itself.
- **Thresholds move on purpose, in the PR that needs it, with the reason:** page-weight budgets
  (`e2e/performance.spec.ts`) and the coverage floor (`vitest.config.ts`). Raise the coverage
  floor when coverage improves; never lower it to get green.

## Environment variables

None are required in development. Production needs `DATABASE_URL` and `AUTH_SECRET`; optional
keys (`ANTHROPIC_API_KEY`, `GOOGLE_TTS_API_KEY`, …) switch on Claude content generation, the
Claude chat tutor and server-side audio. The full table is under "Configuration" in
[README.md](README.md). Never commit `.env*` files.

## CI and pull requests

`master` is protected: "Lint, typecheck, unit tests", "Integration + end-to-end" and "title" must
pass before a PR merges (admins can still push directly). What runs, and why, is in the
"Continuous integration" table in [README.md](README.md). Things that matter when you open a PR:

- **PR titles** are Conventional Commits (`pr-title.yml`). Merge with **rebase** to keep atomic
  commits; squash only single-purpose PRs (it uses the title as the commit message).
- **Bots on every PR:** area labels, a screenshots comment (desktop and mobile), a Claude code
  review on open, a Claude Tagalog review when `content/` changes, CodeRabbit, and CodeQL. Read
  their comments, fix what's right, and reply with reasons where you disagree.
- **Workflow changes:** run `docker run --rm -v "$PWD:/repo" -w /repo rhysd/actionlint:1.7.12`
  before pushing. Untrusted values (titles, bodies, branch names) go through `env:`, never inline
  in `run:`. `pull_request_target` jobs must never check out or run PR code. A Claude workflow
  only runs once its file on the PR is identical to `master`'s, so a new or edited one can't be
  tested from its own PR.
- **Dependabot:** grouped npm minor and patch updates auto-merge when green; majors and the
  Actions group need a look (check release notes, merge if CI is green). TypeScript majors are
  held until typescript-eslint supports them. A security override in `package.json` stays until
  `src/test/dependency-overrides.test.ts` says it can go.
- **`@claude`** on an issue or PR (owner only) starts Claude Code in Actions.

## Agent workflow

- **Claude Code config** is in `.claude/settings.json`: the plugins this project uses (Playwright
  for browser checks, Prisma, the TypeScript LSP, frontend-design, fe-rail and others). Their MCP
  servers come with the plugins, so the repo has no `.mcp.json`. Put personal overrides in
  `.claude/settings.local.json`, which is git-ignored.
- **Agent notes** are in [`docs/agents/`](docs/agents/), for example the Tatoeba research behind
  the course's glosses and example sentences.
- **Scratch work** (one-off Playwright scripts, screenshots) goes in `e2e/.scratch/` and
  `screenshots/`. Both are git-ignored, and Playwright skips `.scratch`.
- **Git worktrees:** Turbopack can't build with a symlinked `node_modules` ("Could not find the
  Next.js package"). Run `npm ci` in the worktree, or hard-link a copy from a checkout on the same
  lockfile (`cp -al ../tagalingo/node_modules node_modules`), then `npx prisma generate`.
- **Waiting in Playwright:** prefer `waitForLoadState("load")` plus `document.fonts.ready` over
  `"networkidle"` after client-side navigation; route prefetches the browser abandons can keep
  the network busy indefinitely.
