/** Right-hand column on wide screens: daily goal, streak status and league position. */
import Link from "next/link";
import { Card, Avatar } from "@/components/ui";
import { GoalRing } from "@/components/stats";
import { SunIcon } from "@/components/icons";
import type { LearnerStats } from "@/server/learner";
import { getWeeklyLeaderboard } from "@/server/leaderboard";

export async function SidePanel({ userId, stats }: { userId: string; stats: LearnerStats }) {
  const board = await getWeeklyLeaderboard(userId, 30);
  const me = board.rows.find((r) => r.isMe) ?? board.me;
  const myIndex = board.rows.findIndex((r) => r.isMe);
  const around = myIndex >= 0 ? board.rows.slice(Math.max(0, myIndex - 1), myIndex + 2) : board.rows.slice(0, 3);
  const goalMet = stats.todayXp >= stats.dailyGoalXp;

  return (
    <div className="sticky top-20 space-y-4">
      <Card className="flex items-center gap-4">
        <GoalRing xp={stats.todayXp} goal={stats.dailyGoalXp} />
        <div>
          <h2 className="font-display text-xl">Daily goal</h2>
          <p className="text-ink-soft">
            {goalMet ? "Done for today. Magaling!" : `${stats.dailyGoalXp - stats.todayXp} XP to go today.`}
          </p>
        </div>
      </Card>

      <Card className="flex items-center gap-4">
        <SunIcon size={44} className={stats.streakSafeToday ? "text-mango" : "text-line"} />
        <div>
          <h2 className="font-display text-xl">
            {stats.streak} day{stats.streak === 1 ? "" : "s"}
          </h2>
          <p className="text-ink-soft">
            {stats.streakSafeToday
              ? "Your streak is safe today."
              : stats.streak > 0
                ? "Finish a lesson today to keep it going."
                : "Finish a lesson to start a streak."}
          </p>
        </div>
      </Card>

      <Card>
        <div className="mb-3 flex items-baseline justify-between">
          <h2 className="font-display text-xl">Barkada League</h2>
          <Link href="/leaderboard" className="font-bold text-lagoon hover:underline">
            View all
          </Link>
        </div>
        <ol className="space-y-2">
          {around.map((r) => (
            <li
              key={r.userId}
              className={`flex items-center gap-3 rounded-2xl px-2 py-1.5 ${r.isMe ? "bg-lagoon-soft" : ""}`}
            >
              <span className="w-6 text-right font-bold text-ink-soft">{r.rank}</span>
              <Avatar name={r.name} hue={r.avatarHue} size={32} />
              <span className="flex-1 truncate font-bold">{r.isMe ? "You" : r.name}</span>
              <span className="text-ink-soft">{r.xp} XP</span>
            </li>
          ))}
          {myIndex < 0 && me && (
            <li className="flex items-center gap-3 rounded-2xl bg-lagoon-soft px-2 py-1.5">
              <span className="w-6 text-right font-bold text-ink-soft">{me.rank}</span>
              <Avatar name={me.name} hue={me.avatarHue} size={32} />
              <span className="flex-1 font-bold">You</span>
              <span className="text-ink-soft">{me.xp} XP</span>
            </li>
          )}
        </ol>
      </Card>
    </div>
  );
}
