import type { Metadata } from "next";
import Link from "next/link";
import { SignupForm } from "../auth-forms";

export const metadata: Metadata = { title: "Create your account" };

export default function SignupPage() {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="font-display text-4xl text-ink">Tara na!</h1>
        <p className="mt-1 text-ink-soft">That means “let’s go”. Make an account to keep your streak and XP.</p>
      </div>
      <SignupForm />
      <p className="text-center text-ink-soft">
        Already learning?{" "}
        <Link href="/login" className="font-bold text-lagoon underline-offset-4 hover:underline">
          Log in
        </Link>
      </p>
    </div>
  );
}
