/**
 * Grant (or revoke) Studio reviewer access for an existing account.
 *
 *   npm run user:make-reviewer -- --email you@example.org
 *   npm run user:make-reviewer -- --email you@example.org --revoke
 */
import "dotenv/config";
import { parseArgs } from "node:util";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../src/generated/prisma/client";
import { LOCAL_DATABASE_URL } from "../src/lib/env-defaults";

async function main() {
  const { values } = parseArgs({ options: { email: { type: "string" }, revoke: { type: "boolean", default: false } } });
  if (!values.email) throw new Error("Usage: npm run user:make-reviewer -- --email <address> [--revoke]");
  const prisma = new PrismaClient({
    adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL || LOCAL_DATABASE_URL }),
  });
  try {
    const user = await prisma.user.update({
      where: { email: values.email.trim().toLowerCase() },
      data: { isReviewer: !values.revoke },
    });
    console.log(`${user.email} is ${user.isReviewer ? "now a reviewer" : "no longer a reviewer"}.`);
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exitCode = 1;
});
