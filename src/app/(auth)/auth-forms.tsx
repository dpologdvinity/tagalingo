"use client";
/**
 * Login and sign-up forms. Both post to server actions via useActionState, so they also work
 * before JavaScript loads.
 */
import { useActionState } from "react";
import { useFormStatus } from "react-dom";
import { demoLoginAction, loginAction, signupAction, type AuthFormState } from "@/app/actions/auth";
import { Button } from "@/components/ui";

const input =
  "w-full rounded-2xl border-2 border-line bg-surface px-4 py-3 text-base outline-none focus:border-lagoon-bright";

function Submit({ children, variant = "primary" }: { children: React.ReactNode; variant?: "primary" | "secondary" }) {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" variant={variant} disabled={pending} className="w-full">
      {pending ? "One moment…" : children}
    </Button>
  );
}

function ErrorBanner({ state }: { state: AuthFormState }) {
  if (!state?.error) return null;
  return (
    <p role="alert" className="rounded-2xl bg-gumamela-soft px-4 py-3 font-bold text-gumamela">
      {state.error}
    </p>
  );
}

export function DemoButton() {
  const [state, action] = useActionState(demoLoginAction, undefined);
  return (
    <form action={action} className="space-y-3">
      {state?.error && (
        <p role="alert" className="rounded-2xl bg-gumamela-soft px-4 py-3 font-bold text-gumamela">
          The demo account isn’t available on this site. Create an account instead.
        </p>
      )}
      <Submit variant="secondary">Try the demo account</Submit>
    </form>
  );
}

export function LoginForm() {
  const [state, action] = useActionState(loginAction, undefined);
  return (
    <form action={action} className="space-y-4">
      <ErrorBanner state={state} />
      <label className="block">
        <span className="mb-1 block font-bold">Email</span>
        <input
          name="email"
          type="email"
          autoComplete="email"
          required
          defaultValue={state?.fields?.email}
          className={input}
        />
      </label>
      <label className="block">
        <span className="mb-1 block font-bold">Password</span>
        <input name="password" type="password" autoComplete="current-password" required className={input} />
      </label>
      <Submit>Log in</Submit>
    </form>
  );
}

export function SignupForm() {
  const [state, action] = useActionState(signupAction, undefined);
  // Streaks are counted in the learner's own timezone, which only the browser knows.
  const submit = (form: FormData) => {
    form.set("timezone", Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC");
    action(form);
  };
  return (
    <form action={submit} className="space-y-4">
      <ErrorBanner state={state} />
      <label className="block">
        <span className="mb-1 block font-bold">Your name</span>
        <input
          name="name"
          autoComplete="given-name"
          required
          maxLength={40}
          defaultValue={state?.fields?.name}
          className={input}
        />
      </label>
      <label className="block">
        <span className="mb-1 block font-bold">Email</span>
        <input
          name="email"
          type="email"
          autoComplete="email"
          required
          defaultValue={state?.fields?.email}
          className={input}
        />
      </label>
      <label className="block">
        <span className="mb-1 block font-bold">Password</span>
        <input name="password" type="password" autoComplete="new-password" required minLength={8} className={input} />
        <span className="mt-1 block text-sm text-ink-soft">At least 8 characters.</span>
      </label>
      <Submit>Create account</Submit>
    </form>
  );
}
