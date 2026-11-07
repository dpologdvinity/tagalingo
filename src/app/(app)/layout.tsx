/**
 * Signed-in app frame: navigation, the stat strip and (on wide screens) a side column with the
 * daily goal and league position. Every page below this is per-learner and rendered dynamically.
 */
import Link from "next/link";
import { BottomNav, SideNav } from "@/components/app-nav";
import { StatStrip } from "@/components/stats";
import { Tala } from "@/components/tala";
import { getLearnerStats } from "@/server/learner";
import { requireUser } from "@/server/session";
import { SidePanel } from "./side-panel";

export default async function AppLayout({ children }: LayoutProps<"/">) {
  const user = await requireUser();
  const stats = await getLearnerStats(user);
  return (
    <div className="flex min-h-screen">
      <SideNav isReviewer={stats.isReviewer} />
      <div className="flex min-w-0 flex-1 flex-col">
        <header className="sticky top-0 z-10 flex items-center justify-between border-b-2 border-line bg-surface/95 px-4 py-3 backdrop-blur lg:justify-end lg:border-none lg:bg-transparent lg:px-8 lg:backdrop-blur-none">
          <Link href="/learn" className="lg:hidden" aria-label="Tagalingo home">
            <Tala size={34} />
          </Link>
          <StatStrip stats={stats} />
        </header>
        <div className="flex flex-1 justify-center gap-10 px-4 pb-28 pt-4 lg:px-8 lg:pb-12">
          <main className="w-full max-w-xl min-w-0">{children}</main>
          <aside className="hidden w-80 shrink-0 xl:block">
            <SidePanel userId={user.id} stats={stats} />
          </aside>
        </div>
      </div>
      <BottomNav isReviewer={stats.isReviewer} />
    </div>
  );
}
