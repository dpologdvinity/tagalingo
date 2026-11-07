import type { Metadata } from "next";
import { GoalRing } from "@/components/stats";
import { getPathForUser } from "@/server/course";
import { getLearnerStats } from "@/server/learner";
import { requireUser } from "@/server/session";
import { SkillPath } from "./skill-path";

export const metadata: Metadata = { title: "Learn" };

export default async function LearnPage() {
  const user = await requireUser();
  const [path, stats] = await Promise.all([getPathForUser(user.id), getLearnerStats(user)]);
  if (!path) {
    return (
      <div className="rounded-3xl border-2 border-dashed border-line p-8 text-center">
        <h1 className="font-display text-2xl">No course loaded yet</h1>
        <p className="mt-2 text-ink-soft">
          Run <code className="rounded bg-surface px-1.5 py-0.5">npm run db:seed</code> to load the Tagalog course.
        </p>
      </div>
    );
  }
  return (
    <>
      <h1 className="sr-only">{path.courseTitle}</h1>
      {/* On narrow screens the side column is hidden, so the daily goal lives at the top of the path. */}
      <section aria-label="Daily goal" className="mb-6 flex items-center gap-4 rounded-3xl border-2 border-line bg-surface p-4 xl:hidden">
        <GoalRing xp={stats.todayXp} goal={stats.dailyGoalXp} size={64} />
        <p>
          <strong className="block font-display text-lg">Daily goal</strong>
          <span className="text-ink-soft">
            {stats.todayXp >= stats.dailyGoalXp
              ? "Done for today. Magaling!"
              : `${stats.dailyGoalXp - stats.todayXp} XP to go today.`}
          </span>
        </p>
      </section>
      <SkillPath path={path} />
    </>
  );
}
