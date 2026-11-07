/**
 * Server-side session helpers. Pages and server actions call these instead of trusting the
 * JWT alone, so a deleted user (e.g. after `db:reset`) is treated as signed out.
 */
import "server-only";
import { notFound, redirect } from "next/navigation";
import { auth } from "@/auth";
import { db } from "@/lib/db";
import type { User } from "@/generated/prisma/client";

/** The signed-in user, or null (no session, or session for a user that no longer exists). */
export async function getCurrentUser(): Promise<User | null> {
  const session = await auth();
  const id = session?.user?.id;
  if (!id) return null;
  return db.user.findUnique({ where: { id } });
}

export async function requireUser(): Promise<User> {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  return user;
}

/** Studio pages: non-reviewers get a 404 rather than a hint that the page exists. */
export async function requireReviewer(): Promise<User> {
  const user = await requireUser();
  if (!user.isReviewer) notFound();
  return user;
}
