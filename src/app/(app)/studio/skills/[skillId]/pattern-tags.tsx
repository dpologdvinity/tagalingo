"use client";
/**
 * The grammar patterns an exercise is tagged with: chips, plus an editor (checkboxes for every
 * pattern in the course) that saves the whole set. Tags drive per-pattern progress and the "?" chip
 * in the lesson player, so a reviewer can fix a drill the generator tagged wrongly.
 */
import { useState, useTransition } from "react";
import { setExercisePatternsAction, type StudioResult } from "@/app/actions/studio";
import { Button } from "@/components/ui";
import { Message } from "./review-controls";

type PatternRef = { slug: string; title: string };

export function PatternTags({
  exerciseId,
  tagged,
  options,
}: {
  exerciseId: string;
  tagged: PatternRef[];
  options: PatternRef[];
}) {
  const [pending, start] = useTransition();
  const [result, setResult] = useState<StudioResult | null>(null);
  const [editing, setEditing] = useState(false);
  const [chosen, setChosen] = useState(() => new Set(tagged.map((t) => t.slug)));

  const toggle = (slug: string) =>
    setChosen((prev) => {
      const next = new Set(prev);
      if (!next.delete(slug)) next.add(slug);
      return next;
    });
  const cancel = () => {
    setChosen(new Set(tagged.map((t) => t.slug)));
    setEditing(false);
  };
  const save = () =>
    start(async () => {
      const r = await setExercisePatternsAction(exerciseId, [...chosen]);
      setResult(r);
      if (r.ok) setEditing(false);
    });

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-2 text-sm">
        <span className="text-ink-soft">Patterns:</span>
        {tagged.length === 0 && <span className="text-ink-soft">none</span>}
        {tagged.map((t) => (
          <span key={t.slug} className="rounded-full bg-lagoon-soft px-2.5 py-0.5 font-bold text-lagoon">
            {t.title}
          </span>
        ))}
        {!editing && options.length > 0 && (
          <Button variant="ghost" onClick={() => setEditing(true)} className="px-3 py-1 text-sm">
            Edit patterns
          </Button>
        )}
      </div>
      {editing && (
        <fieldset className="space-y-1 rounded-2xl border-2 border-line p-3">
          <legend className="px-1 text-sm font-bold">Tag this exercise with</legend>
          {options.map((o) => (
            <label key={o.slug} className="flex items-center gap-2">
              <input type="checkbox" checked={chosen.has(o.slug)} onChange={() => toggle(o.slug)} className="h-4 w-4" />
              {o.title}
            </label>
          ))}
          <div className="flex flex-wrap gap-2 pt-2">
            <Button variant="mango" disabled={pending} onClick={save} className="px-4 py-2 text-sm">
              Save patterns
            </Button>
            <Button variant="ghost" disabled={pending} onClick={cancel} className="px-4 py-2 text-sm">
              Cancel
            </Button>
          </div>
        </fieldset>
      )}
      <Message result={result} />
    </div>
  );
}
