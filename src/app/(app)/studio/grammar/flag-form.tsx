"use client";
/** Studio grammar tab controls: flag a problem with a card, and resolve an open flag. */
import { useState, useTransition } from "react";
import { flagCardAction, resolveFlagAction, type StudioResult } from "@/app/actions/studio";
import { Button } from "@/components/ui";
import { Message } from "../skills/[skillId]/review-controls";

export function FlagForm({ patternSlug, patternTitle }: { patternSlug: string; patternTitle: string }) {
  const [pending, start] = useTransition();
  const [result, setResult] = useState<StudioResult | null>(null);
  const [note, setNote] = useState("");

  const submit = () =>
    start(async () => {
      const r = await flagCardAction(patternSlug, note);
      // Success shows up in the flag lists, so only a failure needs a message.
      setResult(r.ok ? null : r);
      if (r.ok) setNote("");
    });

  return (
    <div className="space-y-2">
      <label className="block">
        <span className="mb-1 block text-sm font-bold">
          Flag a problem<span className="sr-only"> with {patternTitle}</span>
        </span>
        <textarea
          value={note}
          onChange={(e) => setNote(e.target.value)}
          maxLength={500}
          rows={2}
          placeholder="What is wrong or unclear?"
          className="w-full rounded-xl border-2 border-line px-3 py-2 text-sm outline-none focus:border-lagoon-bright"
        />
      </label>
      <Button
        variant="secondary"
        disabled={pending || !note.trim()}
        onClick={submit}
        className="px-4 py-2 text-sm"
        aria-label={`Flag ${patternTitle}`}
      >
        Flag
      </Button>
      <Message result={result} />
    </div>
  );
}

export function ResolveButton({ flagId }: { flagId: string }) {
  const [pending, start] = useTransition();
  const [result, setResult] = useState<StudioResult | null>(null);
  return (
    <span className="inline-flex flex-wrap items-center gap-2">
      <Button
        variant="secondary"
        disabled={pending}
        onClick={() => start(async () => setResult(await resolveFlagAction(flagId)))}
        className="px-4 py-2 text-sm"
      >
        Resolve
      </Button>
      {result && !result.ok && <Message result={result} />}
    </span>
  );
}
