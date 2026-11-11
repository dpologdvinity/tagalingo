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
npm run test:integration               # needs the Docker DB; uses a separate tagalingo_test DB
npm run build && npm run test:e2e      # for UI changes; needs `npm run setup` first
```

CI (`.github/workflows/ci.yml`) runs the same steps on every push and pull request to `master`.

## Framework notes

- **Next.js 16:** middleware is `src/proxy.ts`; `params`, `searchParams` and `cookies()` are
  async; typed routes are on, so run `npx next typegen` after adding a route.
- **Prisma 7:** the client is generated to `src/generated/prisma` (import from
  `@/generated/prisma/client`) and the datasource URL lives in `prisma.config.ts`. App code uses
  the lazy `db` from `@/lib/db`; scripts and the seed create their own client, because
  `server-only` modules can't run in plain Node.

## Conventions

- **Exercise answers must never reach the client.** Grading happens in `src/server/lessons.ts`;
  send exercises to the browser only through `toClientExercise`.
- Game rules live in `src/lib/game` as pure, unit-tested functions. Write the failing test first.
- Every exercise payload goes through `parseExercise`; add new exercise types there first.
- Schema changes: edit `prisma/schema.prisma`, run `npm run db:migrate -- --name <change>`, and
  commit the migration.
- Commits follow [Conventional Commits](https://www.conventionalcommits.org/) and stay small and
  atomic. Stage files explicitly rather than with `git add -A`.

## Environment variables

None are required in development. Production needs `DATABASE_URL` and `AUTH_SECRET`; optional
keys (`ANTHROPIC_API_KEY`, `GOOGLE_TTS_API_KEY`, …) switch on Claude content generation, the
Claude chat tutor and server-side audio. The full table is under "Configuration" in
[README.md](README.md). Never commit `.env*` files.

## Agent workflow

- **Claude Code config** is in `.claude/settings.json`: the plugins this project uses (Playwright
  for browser checks, Prisma, the TypeScript LSP, frontend-design, fe-rail and others). Their MCP
  servers come with the plugins, so the repo has no `.mcp.json`. Put personal overrides in
  `.claude/settings.local.json`, which is git-ignored.
- **Agent notes** are in [`docs/agents/`](docs/agents/), for example the Tatoeba research behind
  the course's glosses and example sentences.
- **Scratch work** (one-off Playwright scripts, screenshots) goes in `e2e/.scratch/` and
  `screenshots/`. Both are git-ignored, and Playwright skips `.scratch`.
