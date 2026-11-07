"use client";
/**
 * Learner stat widgets: streak, hearts (with a live refill countdown), XP and the daily-goal ring.
 */
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import type { LearnerStats } from "@/server/learner";
import { BoltIcon, HeartIcon, SunIcon } from "./icons";

function formatCountdown(ms: number) {
  const total = Math.max(0, Math.ceil(ms / 1000));
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${m}:${String(s).padStart(2, "0")}`;
}

/** Ticks once per second; refreshes the page data when the next heart arrives. */
export function useHeartCountdown(nextHeartAt: string | null) {
  const router = useRouter();
  const [now, setNow] = useState<number | null>(null);
  useEffect(() => {
    if (!nextHeartAt) return;
    setNow(Date.now());
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [nextHeartAt]);
  const remaining = nextHeartAt && now !== null ? new Date(nextHeartAt).getTime() - now : null;
  useEffect(() => {
    if (remaining !== null && remaining <= 0) router.refresh();
  }, [remaining, router]);
  return remaining === null ? null : formatCountdown(remaining);
}

export function StatStrip({ stats }: { stats: LearnerStats }) {
  const countdown = useHeartCountdown(stats.nextHeartAt);
  return (
    <div className="flex items-center gap-4 text-lg font-bold">
      <span className="inline-flex items-center gap-1.5 text-mango-deep" title={`${stats.streak}-day streak`}>
        <SunIcon size={24} className={stats.streakSafeToday ? "text-mango" : "text-line"} />
        <span className={stats.streakSafeToday ? "" : "text-ink-soft"}>{stats.streak}</span>
        <span className="sr-only">day streak</span>
      </span>
      <span
        className="inline-flex items-center gap-1.5 text-gumamela"
        title={countdown ? `Next heart in ${countdown}` : "Hearts full"}
      >
        <HeartIcon size={22} />
        {stats.hearts}
        <span className="sr-only">hearts{countdown ? `, next in ${countdown}` : ""}</span>
        {countdown && <span className="hidden text-sm font-normal text-ink-soft sm:inline">+1 in {countdown}</span>}
      </span>
      <span className="inline-flex items-center gap-1 text-lagoon" title="Total XP">
        <BoltIcon size={22} className="text-mango" />
        {stats.totalXp.toLocaleString()}
        <span className="sr-only">XP</span>
      </span>
    </div>
  );
}

/** Ring that fills with today's XP toward the daily goal. */
export function GoalRing({ xp, goal, size = 88 }: { xp: number; goal: number; size?: number }) {
  const r = size / 2 - 7;
  const c = 2 * Math.PI * r;
  const progress = Math.min(1, goal > 0 ? xp / goal : 0);
  const done = progress >= 1;
  return (
    <div className="relative inline-flex" style={{ width: size, height: size }}>
      <svg width={size} height={size} className="-rotate-90" aria-hidden>
        <circle cx={size / 2} cy={size / 2} r={r} stroke="var(--color-line)" strokeWidth="10" fill="none" />
        <circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          stroke={done ? "var(--color-mango)" : "var(--color-lagoon-bright)"}
          strokeWidth="10"
          strokeLinecap="round"
          fill="none"
          strokeDasharray={c}
          strokeDashoffset={c * (1 - progress)}
          style={{ transition: "stroke-dashoffset 600ms ease-out" }}
        />
      </svg>
      <span className="absolute inset-0 flex flex-col items-center justify-center leading-none">
        <span className="font-display" style={{ fontSize: size * 0.24 }}>
          {xp}
        </span>
        <span className="text-ink-soft" style={{ fontSize: Math.max(10, size * 0.13) }}>
          of {goal}
        </span>
      </span>
    </div>
  );
}
