/**
 * Weekly Barkada League: XP earned since Monday 00:00 UTC, ranked.
 */
import "server-only";
import { db } from "@/lib/db";
import { nextWeekStartUtc, weekStartUtc } from "@/lib/game/league";

export type LeaderboardRow = { rank: number; userId: string; name: string; xp: number; avatarHue: number; isMe: boolean };

export type Leaderboard = {
  weekStart: string;
  resetsAt: string;
  rows: LeaderboardRow[];
  /** The viewer's own row when they're outside the top `limit` (or have 0 XP). */
  me: LeaderboardRow | null;
};

export async function getWeeklyLeaderboard(viewerId: string, limit = 30, now = new Date()): Promise<Leaderboard> {
  const since = weekStartUtc(now);
  const totals = await db.xpEvent.groupBy({
    by: ["userId"],
    where: { createdAt: { gte: since } },
    _sum: { amount: true },
    orderBy: [{ _sum: { amount: "desc" } }, { userId: "asc" }],
  });
  const top = totals.slice(0, limit);
  const myIndex = totals.findIndex((t) => t.userId === viewerId);
  const ids = [...new Set([...top.map((t) => t.userId), viewerId])];
  const users = await db.user.findMany({ where: { id: { in: ids } }, select: { id: true, name: true, avatarHue: true } });
  const byId = new Map(users.map((u) => [u.id, u]));

  // Standard competition ranking: equal XP shares a rank.
  const rankAt = (i: number) => {
    const xp = totals[i]._sum.amount ?? 0;
    return totals.findIndex((t) => (t._sum.amount ?? 0) === xp) + 1;
  };
  const toRow = (i: number): LeaderboardRow => {
    const t = totals[i];
    const u = byId.get(t.userId);
    return { rank: rankAt(i), userId: t.userId, name: u?.name ?? "Learner", xp: t._sum.amount ?? 0, avatarHue: u?.avatarHue ?? 180, isMe: t.userId === viewerId };
  };

  const rows = top.map((_, i) => toRow(i));
  let me: LeaderboardRow | null = null;
  if (myIndex >= limit) me = toRow(myIndex);
  if (myIndex === -1) {
    const u = byId.get(viewerId);
    me = { rank: totals.length + 1, userId: viewerId, name: u?.name ?? "You", xp: 0, avatarHue: u?.avatarHue ?? 180, isMe: true };
  }
  return { weekStart: since.toISOString(), resetsAt: nextWeekStartUtc(now).toISOString(), rows, me };
}
