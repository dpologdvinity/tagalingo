import type { Metadata } from "next";
import Link from "next/link";
import { DemoButton, LoginForm } from "../auth-forms";

export const metadata: Metadata = { title: "Log in" };

export default function LoginPage() {
  return (
    <div className="space-y-6">
      <h1 className="font-display text-4xl text-ink">Welcome back</h1>
      <LoginForm />
      <div className="flex items-center gap-3 text-sm text-ink-soft">
        <span className="h-0.5 flex-1 bg-line" />
        or
        <span className="h-0.5 flex-1 bg-line" />
      </div>
      <DemoButton />
      <p className="text-center text-ink-soft">
        New here?{" "}
        <Link href="/signup" className="font-bold text-lagoon underline-offset-4 hover:underline">
          Create an account
        </Link>
      </p>
    </div>
  );
}
