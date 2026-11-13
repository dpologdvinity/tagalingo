"use client";
/**
 * Grammar cards in the lesson player: `GrammarCardView` is the card itself (a step before the first
 * drill of a new pattern) and `PatternChip` is the small "?" that reopens a card in a dialog without
 * touching grading. Cards are server-validated (`patternCardSchema`), so this only lays them out.
 */
import { useRef, useState } from "react";
import type { LessonCard } from "@/server/grammar";
import { SpeakButton } from "@/components/speak-button";
import { Button } from "@/components/ui";

/** The card: rule up front, then the table (root column picked out), examples and notes. */
export function GrammarCardView({
  card: { title, card },
  onDone,
  doneLabel = "Got it — let's try",
}: {
  card: LessonCard;
  onDone: () => void;
  doneLabel?: string;
}) {
  return (
    <article aria-labelledby="grammar-card-title" className="space-y-6">
      <h2 id="grammar-card-title" className="font-display text-3xl text-ink sm:text-4xl">
        {title}
      </h2>
      <p className="rounded-3xl border-2 border-lagoon-bright/40 bg-lagoon-soft px-5 py-4 text-lg font-bold text-lagoon sm:text-xl">
        {card.rule}
      </p>

      {card.table && (
        <div className="overflow-x-auto rounded-2xl border-2 border-line">
          <table className="w-full border-collapse text-left text-xs sm:text-lg">
            <thead>
              <tr className="bg-seaglass text-xs text-ink-soft sm:text-sm">
                {card.table.head.map((h, i) => (
                  <th key={i} scope="col" className="px-1.5 py-2 font-bold sm:px-4">
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {card.table.rows.map((row, r) => (
                <tr key={r} className="border-t-2 border-line">
                  {row.map((cell, c) =>
                    c === 0 ? (
                      <th
                        key={c}
                        scope="row"
                        lang="tl"
                        className="bg-mango-soft px-1.5 py-2.5 font-bold text-ink [overflow-wrap:anywhere] sm:px-4"
                      >
                        {cell}
                      </th>
                    ) : (
                      <td key={c} lang="tl" className="px-1.5 py-2.5 font-bold [overflow-wrap:anywhere] sm:px-4">
                        {cell}
                      </td>
                    ),
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <ul className="space-y-3">
        {card.examples.map(([tl, en]) => (
          <li key={tl} className="flex items-center gap-3">
            <SpeakButton text={tl} size="sm" />
            <div>
              <p lang="tl" className="text-lg font-bold">
                {tl}
              </p>
              <p className="text-ink-soft">“{en}”</p>
            </div>
          </li>
        ))}
      </ul>

      {card.notes.length > 0 && (
        <ul className="space-y-2">
          {card.notes.map((note) => (
            <li key={note} className="border-l-4 border-mango pl-3 text-ink-soft">
              {note}
            </li>
          ))}
        </ul>
      )}

      <Button onClick={onDone} className="w-full sm:w-auto sm:min-w-48" autoFocus>
        {doneLabel}
      </Button>
    </article>
  );
}

/** A "?" button that opens one pattern's card in a modal dialog. */
export function PatternChip({ card }: { card: LessonCard }) {
  const ref = useRef<HTMLDialogElement>(null);
  // The card is mounted only while the dialog is open, so closed chips add nothing to the page.
  const [open, setOpen] = useState(false);
  return (
    <>
      <button
        type="button"
        aria-label={`Grammar help: ${card.title}`}
        title={card.title}
        onClick={() => {
          setOpen(true);
          ref.current?.showModal();
        }}
        className="flex h-8 w-8 items-center justify-center rounded-full border-2 border-mango bg-mango-soft text-sm font-bold text-mango-deep shadow-press-mango active:translate-y-[2px] active:shadow-none"
      >
        ?
      </button>
      <dialog
        ref={ref}
        onClose={() => setOpen(false)}
        className="m-auto max-h-[90dvh] w-[min(98vw,40rem)] max-w-none overflow-y-auto rounded-3xl border-2 border-line p-2.5 backdrop:bg-ink/40 sm:p-6"
      >
        {open && <GrammarCardView card={card} onDone={() => ref.current?.close()} doneLabel="Back to the exercise" />}
      </dialog>
    </>
  );
}
