"use client";
/**
 * The skill path, drawn as a jeepney route: each unit opens with a painted route placard and its
 * skills are stops along a winding road. Tapping an open stop shows its lessons and a start button.
 */
import Link from "next/link";
import { useState } from "react";
import type { PathView } from "@/server/course";
import { CheckIcon, LockIcon, StarIcon } from "@/components/icons";
import { buttonClass } from "@/components/ui";

type Unit = PathView["units"][number];
type Skill = Unit["skills"][number];

/** Horizontal offsets (px) that make the road wind left and right. */
const WIND = [0, 56, 84, 56, 0, -56, -84, -56];
const ROW = 120;
const NODE = 76;

function RoutePlacard({ unit }: { unit: Unit }) {
  return (
    <header className="overflow-hidden rounded-3xl text-white shadow-press" style={{ background: unit.color }}>
      <div className="px-5 pb-4 pt-4">
        <p className="font-bold opacity-85">Unit {unit.order}</p>
        <h2 className="font-display text-3xl leading-tight">{unit.title}</h2>
        <p className="mt-1 max-w-sm opacity-90">{unit.subtitle}</p>
      </div>
      {/* Two-tone "chrome" stripe, a nod to hand-painted jeepney trim. */}
      <div aria-hidden className="flex h-3">
        <span className="flex-[3] bg-mango" />
        <span className="flex-1 bg-white/80" />
        <span className="flex-[2] bg-ink/25" />
      </div>
    </header>
  );
}

function Road({ count }: { count: number }) {
  const width = 320;
  const cx = width / 2;
  const points = Array.from({ length: count }, (_, i) => ({ x: cx + WIND[i % WIND.length], y: i * ROW + NODE / 2 }));
  const d = points.reduce((acc, p, i) => {
    if (i === 0) return `M ${p.x} ${p.y}`;
    const prev = points[i - 1];
    const midY = (prev.y + p.y) / 2;
    return `${acc} C ${prev.x} ${midY}, ${p.x} ${midY}, ${p.x} ${p.y}`;
  }, "");
  return (
    <svg
      aria-hidden
      className="pointer-events-none absolute left-1/2 top-0 -translate-x-1/2"
      width={width}
      height={(count - 1) * ROW + NODE}
    >
      <path d={d} stroke="var(--color-line)" strokeWidth="22" fill="none" strokeLinecap="round" />
      <path d={d} stroke="white" strokeWidth="3" strokeDasharray="10 12" fill="none" strokeLinecap="round" />
    </svg>
  );
}

function nodeStyle(state: Skill["state"]) {
  switch (state) {
    case "complete":
      return "bg-mango text-ink shadow-press-mango";
    case "active":
      return "bg-lagoon-bright text-white shadow-press-lagoon ring-8 ring-lagoon-bright/20";
    case "coming_soon":
      return "border-4 border-dashed border-line bg-surface text-ink-soft";
    default:
      return "bg-line text-ink-soft shadow-press";
  }
}

function stateLabel(skill: Skill) {
  switch (skill.state) {
    case "complete":
      return "Complete";
    case "active":
      return `Lesson ${Math.min(skill.completedLessons + 1, skill.totalLessons)} of ${skill.totalLessons}`;
    case "coming_soon":
      return "In review: lessons coming soon";
    default:
      return "Locked: finish the stop before this one";
  }
}

function Stop({ skill, index, open, onToggle }: { skill: Skill; index: number; open: boolean; onToggle: () => void }) {
  const offset = WIND[index % WIND.length];
  const playable = skill.state === "active" || skill.state === "complete";
  return (
    <li className="relative flex flex-col items-center" style={{ height: open ? undefined : ROW, minHeight: ROW }}>
      <div style={{ transform: `translateX(${offset}px)` }} className="relative flex flex-col items-center">
        {skill.state === "active" && !open && (
          // Sits beside the node, on the side facing the centre of the road, so it never covers a label.
          <span
            className={`absolute whitespace-nowrap rounded-xl border-2 border-line bg-surface px-3 py-1 font-display text-lagoon ${
              offset > 0 ? "right-full mr-3" : "left-full ml-3"
            }`}
            style={{ top: NODE / 2 - 18 }}
          >
            Tara na!
          </span>
        )}
        <button
          type="button"
          onClick={onToggle}
          aria-expanded={open}
          aria-label={`${skill.title}: ${stateLabel(skill)}`}
          className={`relative flex items-center justify-center rounded-full text-3xl transition-transform active:translate-y-[3px] ${nodeStyle(skill.state)}`}
          style={{ width: NODE, height: NODE }}
        >
          <span aria-hidden className={skill.state === "locked" ? "opacity-40 grayscale" : ""}>
            {skill.emoji}
          </span>
          {skill.state === "complete" && (
            <span className="absolute -bottom-1 -right-1 rounded-full bg-surface p-0.5 text-mango-deep">
              <StarIcon size={22} />
            </span>
          )}
          {skill.state === "locked" && (
            <span className="absolute -bottom-1 -right-1 rounded-full bg-surface p-1 text-ink-soft">
              <LockIcon size={16} />
            </span>
          )}
        </button>
        <span className="mt-2 font-bold">{skill.title}</span>
      </div>

      {open && (
        <div className="relative z-10 mt-3 mb-6 w-full max-w-sm rounded-3xl border-2 border-line bg-surface p-5 shadow-press">
          <h3 className="font-display text-2xl">
            {skill.emoji} {skill.title}
          </h3>
          <p className="text-ink-soft">{skill.description}</p>
          <ol className="my-4 space-y-1.5">
            {skill.lessons.map((l, i) => (
              <li key={l.id} className="flex items-center gap-2">
                <span
                  className={`flex h-6 w-6 items-center justify-center rounded-full text-xs font-bold ${
                    l.state === "complete" ? "bg-mango text-ink" : l.state === "active" ? "bg-lagoon-bright text-white" : "bg-line text-ink-soft"
                  }`}
                >
                  {l.state === "complete" ? <CheckIcon size={14} /> : i + 1}
                </span>
                <span className={l.state === "locked" ? "text-ink-soft" : "font-bold"}>{l.title}</span>
              </li>
            ))}
          </ol>
          {playable && skill.nextLessonId ? (
            <Link href={`/lesson/${skill.nextLessonId}`} className={buttonClass("primary", "w-full")}>
              {skill.state === "complete" ? "Practise again" : skill.completedLessons > 0 ? "Continue" : "Start lesson"}
            </Link>
          ) : (
            <p className="rounded-2xl bg-seaglass px-4 py-3 text-ink-soft">{stateLabel(skill)}</p>
          )}
        </div>
      )}
    </li>
  );
}

export function SkillPath({ path }: { path: PathView }) {
  const firstActive = path.units.flatMap((u) => u.skills).find((s) => s.state === "active")?.id ?? null;
  const [openId, setOpenId] = useState<string | null>(null);

  return (
    <div className="space-y-10">
      {path.units.map((unit) => (
        <section key={unit.id} aria-labelledby={`unit-${unit.id}`} className="space-y-10">
          <div id={`unit-${unit.id}`}>
            <RoutePlacard unit={unit} />
          </div>
          <div className="relative pt-8">
            <Road count={unit.skills.length} />
            <ol className="relative">
              {unit.skills.map((skill, i) => (
                <Stop
                  key={skill.id}
                  skill={skill}
                  index={i}
                  open={openId === skill.id}
                  onToggle={() => setOpenId((cur) => (cur === skill.id ? null : skill.id))}
                />
              ))}
            </ol>
          </div>
        </section>
      ))}
      {firstActive === null && path.units.length > 0 && (
        <p className="text-center text-ink-soft">You’ve reached the end of the road for now. New stops are in review.</p>
      )}
    </div>
  );
}
