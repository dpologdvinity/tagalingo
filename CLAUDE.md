@AGENTS.md

# Tagalingo — notes for coding agents

- Read PLAN.md (scope) and ARCHITECTURE.md (module boundaries) before changing structure.
- Next.js 16: middleware is `src/proxy.ts`; `params`/`searchParams`/`cookies()` are async;
  typed routes are on, so run `npx next typegen` after adding a route.
- Prisma 7: client is generated to `src/generated/prisma` (import from `@/generated/prisma/client`);
  datasource URL lives in `prisma.config.ts`. App code uses the lazy `db` from `@/lib/db`;
  scripts and the seed create their own client (`server-only` modules can't run in plain Node).
- Verify before claiming done: `npm run lint && npm run typecheck && npm test && npm run test:integration`,
  and `npm run build && npm run test:e2e` for UI changes (needs `npm run setup` first).
- Exercise answers must never reach the client; grading happens in `src/server/lessons.ts`.
- `git add -A` is blocked by a hook in this environment: stage files explicitly.
