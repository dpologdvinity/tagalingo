import type { Metadata } from "next";
import { db } from "@/lib/db";
import { addDays, dayKey } from "@/lib/game/streak";
import { BoltIcon, StarIcon, SunIcon, TrophyIcon } from "@/components/icons";
import { Avatar, Card } from "@/components/ui";
import { getLearnerStats } from "@/server/learner";
import { requireUser } from "@/server/session";
import { logoutAction } from "@/app/actions/auth";
import { SettingsForm } from "./settings-form";

export const metadata: Metadata = { title: "Profile" };

const WEEKS = 12;

/** 12-week activity calendar, Monday-first columns, shaded by XP earned that day. */
function ActivityCalendar({ days, today }: { days: Map<string, number>; today: string }) {
  // Start on the Monday 11 weeks before this week's Monday.
  const weekday = (new Date(`${today}T00:00:00Z`).getUTCDay() + 6) % 7;
  const start = addDays(today, -weekday - (WEEKS - 1) * 7);
  const cols = Array.from({ length: WEEKS }, (_, w) => Array.from({ length: 7 }, (_, d) => addDays(start, w * 7 + d)));
  const shade = (xp: number) =>
    xp === 0
      ? "bg-line/60"
      : xp < 15
        ? "bg-mango-soft"
        : xp < 30
          ? "bg-mango/60"
          : xp < 45
            ? "bg-mango"
            : "bg-mango-deep";
  const activeDays = [...days.values()].filter((x) => x > 0).length;
  return (
    <figure>
      <div
        className="flex gap-1"
        role="img"
        aria-label={`Activity calendar: ${activeDays} active days in the last ${WEEKS} weeks`}
      >
        {cols.map((col, i) => (
          <div key={i} className="flex flex-1 flex-col gap-1">
            {col.map((day) => (
              <span
                key={day}
                title={day > today ? undefined : `${day}: ${days.get(day) ?? 0} XP`}
                className={`aspect-square rounded-[4px] ${day > today ? "bg-transparent" : shade(days.get(day) ?? 0)} ${
                  day === today ? "ring-2 ring-lagoon-bright" : ""
                }`}
              />
            ))}
          </div>
        ))}
      </div>
      <figcaption className="mt-2 text-sm text-ink-soft">
        {activeDays} active day{activeDays === 1 ? "" : "s"} in the last {WEEKS} weeks
      </figcaption>
    </figure>
  );
}

export default async function ProfilePage() {
  const user = await requireUser();
  const today = dayKey(new Date(), user.timezone);
  const [stats, activity, lessonsDone] = await Promise.all([
    getLearnerStats(user),
    db.dailyActivity.findMany({ where: { userId: user.id, day: { gte: addDays(today, -WEEKS * 7) } } }),
    db.lessonProgress.count({ where: { userId: user.id } }),
  ]);
  const timezones = Intl.supportedValuesOf("timeZone");

  const tiles = [
    { icon: SunIcon, color: "text-mango", value: stats.streak, label: "Day streak" },
    { icon: StarIcon, color: "text-mango-deep", value: user.longestStreak, label: "Longest streak" },
    { icon: BoltIcon, color: "text-mango", value: stats.totalXp.toLocaleString(), label: "Total XP" },
    { icon: TrophyIcon, color: "text-lagoon", value: lessonsDone, label: "Lessons finished" },
  ];

  return (
    <div className="space-y-6">
      <header className="flex items-center gap-4">
        <Avatar name={user.name} hue={user.avatarHue} size={72} />
        <div className="min-w-0">
          <h1 className="truncate font-display text-4xl">{user.name}</h1>
          <p className="text-ink-soft">
            Learning since {user.createdAt.toLocaleDateString("en", { month: "long", year: "numeric" })}
          </p>
        </div>
      </header>

      <dl className="grid grid-cols-2 gap-3">
        {tiles.map(({ icon: Icon, color, value, label }) => (
          <div key={label} className="flex items-center gap-3 rounded-2xl border-2 border-line bg-surface p-4">
            <Icon size={30} className={color} />
            <div>
              <dd className="font-display text-2xl leading-none">{value}</dd>
              <dt className="text-sm text-ink-soft">{label}</dt>
            </div>
          </div>
        ))}
      </dl>

      <Card>
        <h2 className="mb-3 font-display text-2xl">Your days</h2>
        <ActivityCalendar days={new Map(activity.map((a) => [a.day, a.xp]))} today={today} />
      </Card>

      <Card>
        <h2 className="mb-4 font-display text-2xl">Settings</h2>
        <SettingsForm name={user.name} dailyGoalXp={user.dailyGoalXp} timezone={user.timezone} timezones={timezones} />
      </Card>

      <form action={logoutAction}>
        <button type="submit" className="font-bold text-gumamela hover:underline">
          Log out
        </button>
      </form>
    </div>
  );
}
