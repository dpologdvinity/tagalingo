"use client";
/**
 * Verb tables for browsing and lookup: `VerbTableView` lays one reviewed table out (grammar page,
 * skill page, the sheet), `VerbSheet` is the dialog a tapped word opens, and `TagalogText` renders a
 * line of Tagalog whose known verb forms are tappable. Lookup is progressive: the text shows as
 * plain words first, and words found in the approved tables become buttons once the batch lookup
 * returns. If the lookup fails the text simply stays plain.
 */
import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { lookupWordsAction } from "@/app/actions/grammar";
import { SpeakButton } from "@/components/speak-button";
import { Button } from "@/components/ui";
import type { VerbTableData } from "@/lib/grammar/analyse";
import { tokenize, wordKeys } from "@/lib/grammar/tokenize";
import { FORM_LABEL, VERB_FORMS, type VerbForm } from "@/lib/grammar/types";
import { normalizeAnswer } from "@/lib/normalize";
import type { VerbLookup } from "@/server/grammar";

/** The words after the first are accepted variants: "nakapagluluto / nakakapagluto". */
function cellText(cell: string[]): string {
  return cell.join(" / ");
}

/**
 * One verb table: the root and its English in the first column, then a column per form (the
 * Tagalog grammar name in a smaller second line). `highlight` picks out the cells a word matched.
 * Like the grammar card it wraps text and shrinks padding on narrow screens instead of scrolling
 * the page; a speaker button sits under each form on a phone and beside it from `sm` up.
 */
export function VerbTableView({ table, highlight = [] }: { table: VerbTableData; highlight?: readonly VerbForm[] }) {
  return (
    <div className="overflow-x-auto rounded-2xl border-2 border-line">
      <table className="w-full border-collapse text-left text-xs sm:text-lg">
        <thead>
          <tr className="bg-seaglass text-xs text-ink-soft sm:text-sm">
            <th scope="col" className="px-1.5 py-2 font-bold sm:px-4">
              Root
            </th>
            {VERB_FORMS.map((form) => (
              <th key={form} scope="col" className="px-1.5 py-2 font-bold sm:px-4">
                {FORM_LABEL[form].en}
                <span lang="tl" className="block text-[0.7rem] font-normal sm:text-xs">
                  {FORM_LABEL[form].tl}
                </span>
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          <tr className="border-t-2 border-line">
            <th scope="row" className="bg-mango-soft px-1.5 py-2.5 font-bold text-ink [overflow-wrap:anywhere] sm:px-4">
              <span lang="tl">{table.root}</span>
              <span className="block text-[0.7rem] font-normal text-ink-soft sm:text-sm">{table.en}</span>
            </th>
            {VERB_FORMS.map((form) => {
              const cell = table.forms[form] ?? [];
              return (
                <td
                  key={form}
                  className={`px-1.5 py-2.5 align-top sm:px-4 ${highlight.includes(form) ? "bg-lagoon-soft" : ""}`}
                >
                  {cell.length ? (
                    <span className="flex flex-col items-start gap-1 sm:flex-row sm:items-center sm:gap-2">
                      <span lang="tl" className="font-bold [overflow-wrap:anywhere]">
                        {cellText(cell)}
                      </span>
                      <SpeakButton text={cell[0]} size="sm" />
                    </span>
                  ) : (
                    <span className="text-ink-soft">
                      <span aria-hidden>—</span>
                      <span className="sr-only">none</span>
                    </span>
                  )}
                </td>
              );
            })}
          </tr>
        </tbody>
      </table>
    </div>
  );
}

/** "past", "infinitive": the first name of a form, without the "/ command" alternative. */
const formName = (form: VerbForm) => FORM_LABEL[form].en.split(" / ")[0];

/** A modal that explains one tapped word: its readings and the verb table(s) it belongs to. */
export function VerbSheet({ word, lookups, onClose }: { word: string; lookups: VerbLookup[]; onClose: () => void }) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const dialog = ref.current;
    if (dialog && !dialog.open) dialog.showModal();
  }, []);
  return (
    <dialog
      ref={ref}
      onClose={onClose}
      aria-labelledby="verb-sheet-title"
      className="m-auto max-h-[90dvh] w-[min(98vw,40rem)] max-w-none overflow-y-auto rounded-3xl border-2 border-line p-2.5 backdrop:bg-ink/40 sm:p-6"
    >
      <div className="space-y-5">
        <h2 id="verb-sheet-title" lang="tl" className="font-display text-3xl text-ink sm:text-4xl">
          {word}
        </h2>
        {lookups.map(({ table, analyses }) => (
          <section key={`${table.root}/${table.affix}`} className="space-y-2">
            <p className="text-lg text-ink-soft">
              <span lang="tl" className="font-bold text-ink">
                {table.root}
              </span>{" "}
              · {table.affix.replace("_", " ")} · {table.en}
            </p>
            <p className="font-bold text-lagoon">
              {analyses.map((a) => formName(a.form)).join(" and ")} of <span lang="tl">{table.root}</span>
            </p>
            <VerbTableView table={table} highlight={analyses.map((a) => a.form)} />
          </section>
        ))}
        <Button variant="secondary" onClick={() => ref.current?.close()} className="w-full sm:w-auto" autoFocus>
          Close
        </Button>
      </div>
    </dialog>
  );
}

/** Most distinct words one lookup asks for; the server refuses more (a chat reply is far shorter). */
const MAX_LOOKUP_WORDS = 60;

/**
 * Tagalog text with its known verb forms underlined and tappable. Punctuation and spacing come out
 * as written; words that are not in an approved verb table stay plain text.
 */
export function TagalogText({ text }: { text: string }) {
  const tokens = useMemo(() => tokenize(text), [text]);
  const [found, setFound] = useState<Record<string, VerbLookup[]>>({});
  const [open, setOpen] = useState<{ word: string; lookups: VerbLookup[] } | null>(null);

  useEffect(() => {
    const keys = wordKeys(tokens).slice(0, MAX_LOOKUP_WORDS);
    if (!keys.length) return;
    let current = true;
    lookupWordsAction(keys)
      .then((result) => current && setFound(result))
      .catch(() => undefined); // no lookup: the text stays plain
    return () => {
      current = false;
    };
  }, [tokens]);

  return (
    <span>
      {tokens.map((token, i) => {
        const lookups = token.word ? found[normalizeAnswer(token.text)] : undefined;
        return lookups ? (
          <button
            key={i}
            type="button"
            aria-label={`Look up ${token.text}`}
            onClick={() => setOpen({ word: token.text, lookups })}
            className="underline decoration-dotted decoration-2 underline-offset-4 hover:text-lagoon"
          >
            {token.text}
          </button>
        ) : (
          <span key={i}>{token.text}</span>
        );
      })}
      {/* A portal, because a <dialog> may not sit inside the <p> that holds the message. */}
      {open &&
        createPortal(
          <VerbSheet word={open.word} lookups={open.lookups} onClose={() => setOpen(null)} />,
          document.body,
        )}
    </span>
  );
}
