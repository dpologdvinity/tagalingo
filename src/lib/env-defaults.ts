/**
 * Development defaults shared by the Prisma CLI config and the runtime env loader.
 *
 * Kept dependency-free so `prisma.config.ts` can import it without pulling in app code.
 */

/** Matches the `db` service in docker-compose.yml. */
export const LOCAL_DATABASE_URL = "postgresql://tagalingo:tagalingo@localhost:5433/tagalingo";

/**
 * Auth.js secret used only outside production so the app boots with no `.env`.
 * `getEnv()` refuses to use it when NODE_ENV === "production".
 */
export const DEV_AUTH_SECRET = "tagalingo-dev-only-secret-do-not-use-in-production";
