"use server";
/**
 * Sign-up, sign-in, demo sign-in and sign-out server actions.
 */
import bcrypt from "bcryptjs";
import { AuthError } from "next-auth";
import { z } from "zod";
import { signIn, signOut } from "@/auth";
import { db } from "@/lib/db";
import { Prisma } from "@/generated/prisma/client";
import { DEMO_ACCOUNT } from "@/lib/demo";

export type AuthFormState = { error?: string; fields?: Record<string, string> } | undefined;

async function signInOrError(email: string, password: string): Promise<AuthFormState> {
  try {
    await signIn("credentials", { email, password, redirectTo: "/learn" });
  } catch (e) {
    // signIn throws a redirect on success; only AuthErrors mean "wrong credentials".
    if (e instanceof AuthError) return { error: "That email and password don't match an account." };
    throw e;
  }
}

export async function loginAction(_: AuthFormState, form: FormData): Promise<AuthFormState> {
  const email = String(form.get("email") ?? "")
    .trim()
    .toLowerCase();
  const password = String(form.get("password") ?? "");
  if (!email || !password) return { error: "Enter your email and password.", fields: { email } };
  return { ...(await signInOrError(email, password)), fields: { email } };
}

export async function demoLoginAction(): Promise<AuthFormState> {
  return signInOrError(DEMO_ACCOUNT.email, DEMO_ACCOUNT.password);
}

const signupSchema = z.object({
  name: z.string().trim().min(1, "Tell us what to call you.").max(40, "Keep your name under 40 characters."),
  email: z.string().trim().toLowerCase().pipe(z.email("Enter a valid email address.")),
  password: z.string().min(8, "Use at least 8 characters.").max(200),
  timezone: z.string().max(64).optional(),
});

function validTimezone(tz: string | undefined) {
  if (!tz) return "UTC";
  try {
    new Intl.DateTimeFormat("en", { timeZone: tz });
    return tz;
  } catch {
    return "UTC";
  }
}

export async function signupAction(_: AuthFormState, form: FormData): Promise<AuthFormState> {
  const raw = Object.fromEntries(["name", "email", "password", "timezone"].map((k) => [k, String(form.get(k) ?? "")]));
  const fields = { name: raw.name, email: raw.email };
  const parsed = signupSchema.safeParse(raw);
  if (!parsed.success) return { error: parsed.error.issues[0].message, fields };

  const { name, email, password, timezone } = parsed.data;
  if (await db.user.findUnique({ where: { email } })) {
    return { error: "An account with that email already exists. Log in instead.", fields };
  }
  try {
    await db.user.create({
      data: {
        name,
        email,
        passwordHash: await bcrypt.hash(password, 10),
        timezone: validTimezone(timezone),
        avatarHue: Math.floor(Math.random() * 360),
      },
    });
  } catch (e) {
    // Two sign-ups racing for the same email: the unique index wins, report it like the check above.
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") {
      return { error: "An account with that email already exists. Log in instead.", fields };
    }
    throw e;
  }
  return signInOrError(email, password);
}

export async function logoutAction() {
  await signOut({ redirectTo: "/" });
}
