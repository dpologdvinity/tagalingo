"use client";
/**
 * Flip-card vocabulary review: Tagalog (with picture and audio) on the front, meaning and
 * example sentence on the back. Arrow keys move between cards, space flips.
 */
import { useEffect, useState } from "react";
import { SpeakButton } from "@/components/speak-button";
import { Button } from "@/components/ui";
import type { SkillPageData } from "@/server/course";

type Word = SkillPageData["words"][number];

export function Flashcards({ words }: { words: Word[] }) {
  const [index, setIndex] = useState(0);
  const [flipped, setFlipped] = useState(false);
  const word = words[index];

  const go = (delta: number) => {
    setIndex((i) => (i + delta + words.length) % words.length);
    setFlipped(false);
  };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;
      if (e.key === "ArrowRight") go(1);
      else if (e.key === "ArrowLeft") go(-1);
      else if (e.key === " ") {
        e.preventDefault();
        setFlipped((f) => !f);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  if (!word) return null;
  return (
    <div className="space-y-4">
      <button
        type="button"
        onClick={() => setFlipped((f) => !f)}
        aria-label={flipped ? `Meaning: ${word.en}. Tap to show the Tagalog.` : `${word.tl}. Tap to show the meaning.`}
        className="flex min-h-56 w-full flex-col items-center justify-center gap-3 rounded-3xl border-2 border-line bg-surface p-6 text-center shadow-press"
      >
        {!flipped ? (
          <>
            {word.pic && (
              <span aria-hidden className="text-6xl">
                {word.pic}
              </span>
            )}
            <span lang="tl" className="font-display text-4xl text-ink">
              {word.tl}
            </span>
            <span className="text-sm text-ink-soft">Tap to see the meaning</span>
          </>
        ) : (
          <>
            <span className="font-display text-3xl text-lagoon">{word.en}</span>
            <span className="text-sm text-ink-soft">{word.pos}</span>
            {word.exampleTl && (
              <span className="mt-2 block">
                <span lang="tl" className="block text-lg font-bold">
                  {word.exampleTl}
                </span>
                <span className="block text-ink-soft">{word.exampleEn}</span>
              </span>
            )}
            {word.notes && <span className="mt-1 block max-w-md text-sm text-ink-soft">{word.notes}</span>}
          </>
        )}
      </button>
      <div className="flex items-center justify-between gap-3">
        <Button variant="secondary" onClick={() => go(-1)} aria-label="Previous card" className="px-4">
          ←
        </Button>
        <div className="flex items-center gap-3">
          <SpeakButton text={word.tl} />
          {word.exampleTl && <SpeakButton text={word.exampleTl} slow label="Play the example slowly" />}
          <span className="text-ink-soft" aria-live="polite">
            {index + 1} / {words.length}
          </span>
        </div>
        <Button variant="secondary" onClick={() => go(1)} aria-label="Next card" className="px-4">
          →
        </Button>
      </div>
    </div>
  );
}
