import type { Metadata } from "next";
import { Avatar } from "@/components/ui";
import { TrophyIcon } from "@/components/icons";
import { getWeeklyLeaderboard, type LeaderboardRow } from "@/server/leaderboard";
import { requireUser } from "@/server/session";

export const metadata: Metadata = { title: "Barkada League" };

function timeUntil(iso: string, now = new Date()) {
  const ms = new Date(iso).getTime() - now.getTime();
  const hours = Math.max(0, Math.floor(ms / 3_600_000));
  const days = Math.floor(hours / 24);
  if (days >= 1) return `${days} day${days === 1 ? "" : "s"} ${hours % 24} hr`;
  return `${hours} hr ${Math.max(0, Math.floor((ms % 3_600_000) / 60_000))} min`;
}

const PODIUM = ["bg-mango text-ink", "bg-[#c9d3df] text-ink", "bg-[#d99a5e] text-white"];

function Row({ row }: { row: LeaderboardRow }) {
  return (
    <li
      className={`flex items-center gap-3 rounded-2xl px-3 py-2.5 sm:gap-4 ${row.isMe ? "bg-lagoon-soft ring-2 ring-lagoon-bright" : ""}`}
      aria-current={row.isMe ? "true" : undefined}
    >
      <span
        className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-full font-bold ${
          row.rank <= 3 ? PODIUM[row.rank - 1] : "text-ink-soft"
        }`}
      >
        {row.rank}
      </span>
      <Avatar name={row.name} hue={row.avatarHue} size={44} />
      <span className="min-w-0 flex-1 truncate text-lg font-bold">{row.isMe ? `${row.name} (you)` : row.name}</span>
      <span className="shrink-0 font-bold text-ink-soft">{row.xp} XP</span>
    </li>
  );
}

export default async function LeaderboardPage() {
  const user = await requireUser();
  const board = await getWeeklyLeaderboard(user.id);
  return (
    <div className="space-y-6">
      <header className="flex items-center gap-4">
        <TrophyIcon size={56} className="text-mango" />
        <div>
          <h1 className="font-display text-4xl">Barkada League</h1>
          <p className="text-ink-soft">Everyone’s XP since Monday. The board resets in {timeUntil(board.resetsAt)}.</p>
        </div>
      </header>

      {board.rows.length === 0 ? (
        <p className="rounded-3xl border-2 border-dashed border-line p-8 text-center text-ink-soft">
          Nobody has earned XP this week yet. Finish a lesson to take first place.
        </p>
      ) : (
        <ol className="space-y-1 rounded-3xl border-2 border-line bg-surface p-2 sm:p-3">
          {board.rows.map((r) => (
            <Row key={r.userId} row={r} />
          ))}
        </ol>
      )}

      {board.me && (
        <div>
          <p className="mb-2 px-3 text-ink-soft">
            {board.me.xp === 0 ? "You haven’t earned XP this week yet." : "Your position"}
          </p>
          <ol className="rounded-3xl border-2 border-line bg-surface p-2 sm:p-3">
            <Row row={board.me} />
          </ol>
        </div>
      )}
    </div>
  );
}
