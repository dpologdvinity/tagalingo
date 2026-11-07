/**
 * Next.js 16 proxy (formerly middleware): redirects signed-out visitors away from app pages.
 * Uses the DB-free Auth.js config; pages re-check the session against the database.
 */
import NextAuth from "next-auth";
import { authConfig } from "./auth.config";

export const { auth: proxy } = NextAuth(authConfig);

export const config = {
  // Skip API routes, Next internals and static files.
  matcher: ["/((?!api|_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|ico|webmanifest)$).*)"],
};
