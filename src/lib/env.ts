/**
 * Typed, validated access to environment variables.
 *
 * Outside production every variable has a safe default so `npm run dev` works on a fresh
 * clone with no `.env`. In production, missing required values fail fast at first use.
 */
import { z } from "zod";
import { DEV_AUTH_SECRET, LOCAL_DATABASE_URL } from "./env-defaults";

const isProd = process.env.NODE_ENV === "production";

const schema = z.object({
  DATABASE_URL: z.url().default(LOCAL_DATABASE_URL),
  AUTH_SECRET: z.string().min(16).default(DEV_AUTH_SECRET),
  HEART_REFILL_MINUTES: z.coerce.number().int().positive().max(24 * 60).default(30),
});

export type Env = z.infer<typeof schema>;

let cached: Env | null = null;

export function getEnv(): Env {
  if (cached) return cached;
  const raw = Object.fromEntries(
    Object.entries({
      DATABASE_URL: process.env.DATABASE_URL,
      AUTH_SECRET: process.env.AUTH_SECRET,
      HEART_REFILL_MINUTES: process.env.HEART_REFILL_MINUTES,
    }).filter(([, v]) => v !== undefined && v !== ""),
  );
  const parsed = schema.safeParse(raw);
  if (!parsed.success) {
    throw new Error(`Invalid environment: ${parsed.error.issues.map((i) => `${i.path}: ${i.message}`).join("; ")}`);
  }
  if (isProd && (!process.env.DATABASE_URL || !process.env.AUTH_SECRET || parsed.data.AUTH_SECRET === DEV_AUTH_SECRET)) {
    throw new Error("DATABASE_URL and a real AUTH_SECRET must be set in production");
  }
  cached = parsed.data;
  return cached;
}

export const heartRefillMs = () => getEnv().HEART_REFILL_MINUTES * 60_000;
