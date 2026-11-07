/**
 * Shared Prisma client (Prisma 7 + pg driver adapter).
 *
 * Created lazily on first use, not at import, so `next build` can import server modules
 * without runtime secrets; env validation still runs the first time a query is made.
 * Cached on globalThis in development so hot reloads don't open a new pool each time.
 */
import "server-only";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "@/generated/prisma/client";
import { getEnv } from "./env";

const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };

function client(): PrismaClient {
  if (!globalForPrisma.prisma) {
    globalForPrisma.prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: getEnv().DATABASE_URL }) });
  }
  return globalForPrisma.prisma;
}

export const db: PrismaClient = new Proxy({} as PrismaClient, {
  get(_target, prop) {
    const real = client();
    const value = Reflect.get(real, prop, real);
    return typeof value === "function" ? value.bind(real) : value;
  },
});
