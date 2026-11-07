/**
 * Next.js 16 proxy (formerly middleware): redirects signed-out visitors away from app pages.
 * Uses the DB-free Auth.js config; pages re-check the session against the database.
 */
import NextAuth from "next-auth";
import type { NextFetchEvent, NextRequest } from "next/server";
import { authConfig } from "./auth.config";

const { auth } = NextAuth(authConfig);
// `authorized` in authConfig decides; this wrapper only runs it.
const gate = auth(() => undefined);

export function proxy(request: NextRequest, event: NextFetchEvent) {
  return gate(request, event as never);
}

export const config = {
  // Skip API routes, Next internals and static files.
  matcher: ["/((?!api|_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|ico|webmanifest)$).*)"],
};
