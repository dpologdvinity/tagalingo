/**
 * Auth.js (v5) setup: email + password via the Credentials provider, JWT sessions.
 *
 * Passwords are hashed with bcrypt. A demo account (seeded) lets anyone try the app with one
 * click from the login page.
 */
import NextAuth, { CredentialsSignin } from "next-auth";
import Credentials from "next-auth/providers/credentials";
import bcrypt from "bcryptjs";
import { z } from "zod";
import { authConfig } from "./auth.config";
import { db } from "@/lib/db";

const credentialsSchema = z.object({
  email: z.string().trim().toLowerCase().pipe(z.email()),
  password: z.string().min(1).max(200),
});

/** Real hash of a throwaway string, compared against when the email is unknown (timing parity). */
const DUMMY_HASH = bcrypt.hashSync("tagalingo-no-such-user", 10);

class InvalidLogin extends CredentialsSignin {
  code = "invalid_credentials";
}

export const { handlers, auth, signIn, signOut } = NextAuth({
  ...authConfig,
  providers: [
    Credentials({
      credentials: { email: { label: "Email" }, password: { label: "Password", type: "password" } },
      async authorize(raw) {
        const parsed = credentialsSchema.safeParse(raw);
        if (!parsed.success) throw new InvalidLogin();
        const user = await db.user.findUnique({ where: { email: parsed.data.email } });
        // Compare even when the user doesn't exist to keep timing similar.
        const ok = await bcrypt.compare(parsed.data.password, user?.passwordHash ?? DUMMY_HASH);
        if (!user || !ok) throw new InvalidLogin();
        return { id: user.id, name: user.name, email: user.email };
      },
    }),
  ],
});
