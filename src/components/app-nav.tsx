"use client";
/** Primary navigation: a left rail on desktop and a bottom tab bar on mobile. */
import Link from "next/link";
import { usePathname } from "next/navigation";
import type { Route } from "next";
import { Logo } from "./tala";
import { PathIcon, PencilIcon, TrophyIcon, UserIcon } from "./icons";

type Item = { href: Route; label: string; icon: typeof PathIcon };

function items(isReviewer: boolean): Item[] {
  const base: Item[] = [
    { href: "/learn", label: "Learn", icon: PathIcon },
    { href: "/leaderboard", label: "League", icon: TrophyIcon },
    { href: "/profile", label: "Profile", icon: UserIcon },
  ];
  return isReviewer ? [...base, { href: "/studio", label: "Studio", icon: PencilIcon }] : base;
}

export function SideNav({ isReviewer }: { isReviewer: boolean }) {
  const pathname = usePathname();
  return (
    <div className="hidden w-60 shrink-0 border-r-2 border-line bg-surface lg:block">
      <nav aria-label="Main" className="sticky top-0 flex h-screen flex-col gap-2 px-4 py-6">
        <Link href="/learn" className="mb-6 px-2" aria-label="Tagalingo home">
          <Logo />
        </Link>
        {items(isReviewer).map(({ href, label, icon: Icon }) => {
          const active = pathname === href || pathname.startsWith(`${href}/`);
          return (
            <Link
              key={href}
              href={href}
              aria-current={active ? "page" : undefined}
              className={`flex items-center gap-3 rounded-2xl border-2 px-3 py-2.5 font-bold ${
                active
                  ? "border-lagoon-bright bg-lagoon-soft text-lagoon"
                  : "border-transparent text-ink-soft hover:bg-seaglass"
              }`}
            >
              <Icon size={26} />
              {label}
            </Link>
          );
        })}
      </nav>
    </div>
  );
}

export function BottomNav({ isReviewer }: { isReviewer: boolean }) {
  const pathname = usePathname();
  return (
    <nav
      aria-label="Main"
      className="fixed inset-x-0 bottom-0 z-20 flex border-t-2 border-line bg-surface pb-[env(safe-area-inset-bottom)] lg:hidden"
    >
      {items(isReviewer).map(({ href, label, icon: Icon }) => {
        const active = pathname === href || pathname.startsWith(`${href}/`);
        return (
          <Link
            key={href}
            href={href}
            aria-current={active ? "page" : undefined}
            className={`flex flex-1 flex-col items-center gap-0.5 py-2 text-xs font-bold ${active ? "text-lagoon" : "text-ink-soft"}`}
          >
            <Icon size={26} />
            {label}
          </Link>
        );
      })}
    </nav>
  );
}
