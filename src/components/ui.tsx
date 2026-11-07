/**
 * Small shared UI primitives. Buttons have a "pressable" bottom edge that collapses on :active,
 * which gives taps a tactile feel without extra animation.
 */
import Link from "next/link";
import type { ComponentProps, ReactNode } from "react";

type Variant = "primary" | "secondary" | "danger" | "mango" | "ghost";

const base =
  "inline-flex items-center justify-center gap-2 rounded-2xl px-5 py-3 font-bold text-base transition-[transform,box-shadow] active:translate-y-[3px] disabled:cursor-not-allowed disabled:opacity-50 disabled:active:translate-y-0";

const variants: Record<Variant, string> = {
  primary: "bg-lagoon-bright text-white shadow-press-lagoon active:shadow-none hover:bg-lagoon",
  secondary: "bg-surface text-ink border-2 border-line shadow-press active:shadow-none hover:bg-seaglass",
  danger: "bg-gumamela text-white shadow-press-gumamela active:shadow-none",
  mango: "bg-mango text-ink shadow-press-mango active:shadow-none",
  ghost: "text-lagoon hover:bg-lagoon-soft",
};

export function buttonClass(variant: Variant = "primary", extra = "") {
  return `${base} ${variants[variant]} ${extra}`;
}

export function Button({ variant = "primary", className = "", ...props }: ComponentProps<"button"> & { variant?: Variant }) {
  return <button className={buttonClass(variant, className)} {...props} />;
}

export function ButtonLink({
  variant = "primary",
  className = "",
  ...props
}: ComponentProps<typeof Link> & { variant?: Variant }) {
  return <Link className={buttonClass(variant, className)} {...props} />;
}

export function Card({ children, className = "" }: { children: ReactNode; className?: string }) {
  return <section className={`rounded-3xl border-2 border-line bg-surface p-5 ${className}`}>{children}</section>;
}

/** Round avatar showing the learner's initials on their colour. */
export function Avatar({ name, hue, size = 40 }: { name: string; hue: number; size?: number }) {
  const initials = name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((p) => p[0]?.toUpperCase())
    .join("");
  return (
    <span
      aria-hidden
      className="inline-flex shrink-0 items-center justify-center rounded-full font-bold text-white"
      style={{ width: size, height: size, background: `hsl(${hue} 55% 42%)`, fontSize: size * 0.38 }}
    >
      {initials || "?"}
    </span>
  );
}

export function FieldError({ message }: { message?: string }) {
  if (!message) return null;
  return <p className="mt-1 text-sm font-bold text-gumamela">{message}</p>;
}
