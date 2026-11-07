/**
 * End-of-lesson screens (rendered inside the client LessonPlayer): results and out-of-hearts.
 */
import { useEffect, useState } from "react";
import type { LessonResult } from "@/server/lessons";
import { BoltIcon, HeartIcon, SunIcon } from "@/components/icons";
import { GoalRing, useHeartCountdown } from "@/components/stats";
import { Tala } from "@/components/tala";
import { ButtonLink } from "@/components/ui";

/** Counts up to `to` once, unless the learner prefers reduced motion. */
function useCountUp(to: number, ms = 900) {
  // Only ever rendered client-side (after a lesson ends), so reading matchMedia here is safe.
  const [reduced] = useState(
    () => typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches,
  );
  const [value, setValue] = useState(() => (reduced ? to : 0));
  useEffect(() => {
    if (reduced) return;
    const start = performance.now();
    let frame = 0;
    const tick = (t: number) => {
      const p = Math.min(1, (t - start) / ms);
      setValue(Math.round(to * (1 - Math.pow(1 - p, 3))));
      if (p < 1) frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [to, ms, reduced]);
  return reduced ? to : value;
}

export function LessonResults({ result, total }: { result: LessonResult; total: number }) {
  const xp = useCountUp(result.xp.total);
  const accuracy = Math.round((total / (total + result.mistakes)) * 100);
  return (
    <main className="mx-auto flex min-h-dvh max-w-md flex-col items-center justify-center gap-8 px-5 py-10 text-center">
      <Tala size={132} mood="cheer" className="animate-hop" />
      <div>
        <h1 className="font-display text-4xl text-lagoon">Lesson complete!</h1>
        <p className="mt-1 text-lg text-ink-soft">
          {result.mistakes === 0 ? "Not a single mistake. Ang galing mo!" : "Every answer right in the end. Good work."}
        </p>
      </div>

      <dl className="grid w-full grid-cols-3 gap-3">
        <div className="rounded-2xl border-2 border-mango bg-mango-soft p-3">
          <dt className="text-sm font-bold text-mango-deep">XP earned</dt>
          <dd className="mt-1 inline-flex items-center gap-1 font-display text-3xl">
            <BoltIcon size={22} className="text-mango" />
            {xp}
          </dd>
        </div>
        <div className="rounded-2xl border-2 border-lagoon-bright bg-lagoon-soft p-3">
          <dt className="text-sm font-bold text-lagoon">Accuracy</dt>
          <dd className="mt-1 font-display text-3xl">{accuracy}%</dd>
        </div>
        <div className="rounded-2xl border-2 border-line bg-surface p-3">
          <dt className="text-sm font-bold text-ink-soft">Streak</dt>
          <dd className="mt-1 inline-flex items-center gap-1 font-display text-3xl">
            <SunIcon size={22} className="text-mango" />
            {result.streak}
          </dd>
        </div>
      </dl>

      <ul className="w-full space-y-1 text-left">
        {result.xp.breakdown.map((b) => (
          <li key={b.label} className="flex justify-between rounded-xl px-3 py-1.5 odd:bg-seaglass">
            <span>{b.label}</span>
            <span className="font-bold">+{b.amount} XP</span>
          </li>
        ))}
      </ul>

      <div className="flex items-center gap-4 rounded-3xl border-2 border-line bg-surface p-4 text-left">
        <GoalRing xp={result.todayXp} goal={result.dailyGoalXp} size={72} />
        <p className="font-bold">
          {result.goalJustReached
            ? "Daily goal reached! See you tomorrow."
            : result.todayXp >= result.dailyGoalXp
              ? "Daily goal already done. Extra practice counts too."
              : `${result.dailyGoalXp - result.todayXp} XP left for today’s goal.`}
          {result.streakExtended && (
            <span className="mt-1 block font-normal text-ink-soft">
              {result.streak === 1 ? "You started a streak." : `Your streak is now ${result.streak} days.`}
            </span>
          )}
        </p>
      </div>

      <ButtonLink href="/learn" className="w-full">
        Continue
      </ButtonLink>
    </main>
  );
}

export function OutOfHearts({ nextHeartAt }: { nextHeartAt: string | null }) {
  const countdown = useHeartCountdown(nextHeartAt);
  return (
    <main className="mx-auto flex min-h-dvh max-w-md flex-col items-center justify-center gap-6 px-5 text-center">
      <Tala size={120} mood="sad" />
      <div>
        <h1 className="font-display text-4xl">You’re out of hearts</h1>
        <p className="mt-2 text-lg text-ink-soft">
          Hearts come back on their own, one every half hour.
          {countdown && (
            <>
              {" "}
              Your next one arrives in <strong className="text-gumamela">{countdown}</strong>.
            </>
          )}
        </p>
      </div>
      <p className="inline-flex items-center gap-1 text-gumamela" aria-hidden>
        {Array.from({ length: 5 }, (_, i) => (
          <HeartIcon key={i} size={28} className={i === 0 && countdown === null ? "" : "opacity-25"} />
        ))}
      </p>
      <ButtonLink href="/learn" className="w-full">
        Back to the path
      </ButtonLink>
    </main>
  );
}
