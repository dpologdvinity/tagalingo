/**
 * Learner dashboard numbers: live hearts, visible streak, today's XP vs goal, weekly XP.
 */
import "server-only";
import { db } from "@/lib/db";
import { heartRefillMs } from "@/lib/env";
import { liveHearts, MAX_HEARTS } from "@/lib/game/hearts";
import { weekStartUtc } from "@/lib/game/league";
import { dayKey, visibleStreak } from "@/lib/game/streak";
import type { User } from "@/generated/prisma/client";

export type LearnerStats = {
  name: string;
  hearts: number;
  maxHearts: number;
  /** ISO timestamp of the next heart refill, or null when full. */
  nextHeartAt: string | null;
  streak: number;
  /** True when a lesson has already been completed today (streak is safe). */
  streakSafeToday: boolean;
  todayXp: number;
  dailyGoalXp: number;
  weeklyXp: number;
  totalXp: number;
  avatarHue: number;
  isReviewer: boolean;
};

export async function getLearnerStats(user: User, now = new Date()): Promise<LearnerStats> {
  const today = dayKey(now, user.timezone);
  const [activity, weekly] = await Promise.all([
    db.dailyActivity.findUnique({ where: { userId_day: { userId: user.id, day: today } } }),
    db.xpEvent.aggregate({ where: { userId: user.id, createdAt: { gte: weekStartUtc(now) } }, _sum: { amount: true } }),
  ]);
  const hearts = liveHearts(user, now, heartRefillMs());
  return {
    name: user.name,
    hearts: hearts.hearts,
    maxHearts: MAX_HEARTS,
    nextHeartAt: hearts.nextHeartAt?.toISOString() ?? null,
    streak: visibleStreak(user, today),
    streakSafeToday: user.lastStreakDay === today,
    todayXp: activity?.xp ?? 0,
    dailyGoalXp: user.dailyGoalXp,
    weeklyXp: weekly._sum.amount ?? 0,
    totalXp: user.totalXp,
    avatarHue: user.avatarHue,
    isReviewer: user.isReviewer,
  };
}
