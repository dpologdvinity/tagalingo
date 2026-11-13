/**
 * One unlocked grammar pattern outside the lesson player: its card, how well the learner knows it
 * and a link to practise just that pattern. Unstyled, so the caller supplies the surrounding card. Shared by the grammar page and the skill page.
 */
import type { Route } from "next";
import { GrammarCardView } from "@/components/player/grammar-card";
import { ButtonLink } from "@/components/ui";
import type { PatternCard } from "@/lib/content/grammar-schema";
import type { StrengthLabel } from "@/lib/game/strength";

const LABEL_TEXT: Record<StrengthLabel, string> = {
  new: "New",
  learning: "Learning",
  solid: "Solid",
  mastered: "Mastered",
};

/** A thin bar for strength (0-1); the label next to it carries the same information in words. */
function StrengthMeter({ label, effective }: { label: StrengthLabel; effective: number }) {
  const percent = Math.round(effective * 100);
  return (
    <div className="flex items-center gap-3">
      <span className="font-bold text-ink-soft">{LABEL_TEXT[label]}</span>
      <div
        role="meter"
        aria-label="Strength"
        aria-valuenow={percent}
        aria-valuemin={0}
        aria-valuemax={100}
        className="h-3 w-28 overflow-hidden rounded-full bg-line"
      >
        <div className="h-full rounded-full bg-mango" style={{ width: `${Math.max(percent, 3)}%` }} />
      </div>
    </div>
  );
}

/** `effective` (decayed strength, 0-1) is optional; without it only the label is shown. */
export function PatternEntry({
  slug,
  title,
  card,
  label,
  effective,
  headingLevel,
}: {
  slug: string;
  title: string;
  card: PatternCard;
  label: StrengthLabel;
  effective?: number;
  headingLevel?: 2 | 3;
}) {
  return (
    <div className="space-y-5">
      <GrammarCardView card={{ slug, title, card, isNew: false }} headingLevel={headingLevel} />
      <div className="flex flex-wrap items-center justify-between gap-3 border-t-2 border-line pt-4">
        {effective === undefined ? (
          <span className="font-bold text-ink-soft">{LABEL_TEXT[label]}</span>
        ) : (
          <StrengthMeter label={label} effective={effective} />
        )}
        <ButtonLink href={`/practice?pattern=${encodeURIComponent(slug)}` as Route} variant="secondary">
          Practise this
        </ButtonLink>
      </div>
    </div>
  );
}
