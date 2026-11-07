/**
 * Edge-safe Auth.js config shared by `proxy.ts` and `auth.ts`.
 *
 * It contains no database access, so the proxy can check sessions cheaply. Real authorization
 * (does this user exist, are they a reviewer?) happens again in server code via `requireUser`.
 */
import type { NextAuthConfig } from "next-auth";
import { DEV_AUTH_SECRET } from "@/lib/env-defaults";

/** Routes anyone may see. Everything else requires a session. */
const PUBLIC_PATHS = ["/", "/login", "/signup"];

export const authConfig = {
  secret: process.env.AUTH_SECRET || (process.env.NODE_ENV === "production" ? undefined : DEV_AUTH_SECRET),
  trustHost: true,
  session: { strategy: "jwt", maxAge: 60 * 60 * 24 * 30 },
  pages: { signIn: "/login" },
  providers: [],
  callbacks: {
    authorized({ auth, request }) {
      const { pathname } = request.nextUrl;
      if (PUBLIC_PATHS.includes(pathname)) return true;
      return !!auth?.user;
    },
    jwt({ token, user }) {
      if (user?.id) token.uid = user.id;
      return token;
    },
    session({ session, token }) {
      if (typeof token.uid === "string") session.user.id = token.uid;
      return session;
    },
  },
} satisfies NextAuthConfig;
