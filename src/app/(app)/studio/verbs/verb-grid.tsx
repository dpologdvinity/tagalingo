"use client";
/**
 * One reviewable verb table: a card with a row per form, each an input holding the cell as comma
 * separated spellings (first = canonical). Save stores the edit (the server recomputes which cells
 * differ from the rules); Approve and Reject act on the saved table. Laid out like the learner's
 * `VerbTableView`, one form per row, so it fits a 390px phone.
 */
import { useId, useState, useTransition } from "react";
import { reviewVerbTableAction, saveVerbTableAction, type StudioResult } from "@/app/actions/studio";
import { SpeakButton } from "@/components/speak-button";
import { Button } from "@/components/ui";
import { buildForms, formatCell, parseCell } from "@/lib/grammar/forms-input";
import { FORM_LABEL, VERB_FORMS, type VerbForm } from "@/lib/grammar/types";
import type { ReviewVerbTable } from "@/server/studio";
import { Message } from "../skills/[skillId]/review-controls";
import { STATUS_STYLE } from "../status-style";

const initialInputs = (table: ReviewVerbTable): Record<VerbForm, string> =>
  Object.fromEntries(VERB_FORMS.map((f) => [f, formatCell(table.forms?.[f])])) as Record<VerbForm, string>;

export function VerbCard({ table }: { table: ReviewVerbTable }) {
  const id = useId();
  const [pending, start] = useTransition();
  const [result, setResult] = useState<StudioResult | null>(null);
  const [inputs, setInputs] = useState(() => initialInputs(table));
  const [note, setNote] = useState("");

  const saved = initialInputs(table);
  // Edits are compared as parsed cells, so spacing around a comma is not a change.
  const dirty = VERB_FORMS.some((f) => formatCell(parseCell(inputs[f])) !== saved[f]);

  const save = () =>
    start(async () => setResult(await saveVerbTableAction(table.id, JSON.stringify(buildForms(inputs)))));
  const review = (next: "APPROVED" | "REJECTED") =>
    start(async () => setResult(await reviewVerbTableAction(table.id, next, note)));

  return (
    <section
      aria-label={`${table.root}, ${table.affix}`}
      className="space-y-3 rounded-3xl border-2 border-line bg-surface p-4 sm:p-5"
    >
      <header className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <h2 className="text-xl font-bold">
          <span lang="tl">
            {table.root} · {table.affix}
          </span>
        </h2>
        <span className="text-ink-soft">{table.en}</span>
        <span className={`ml-auto rounded-full px-2.5 py-0.5 text-sm font-bold ${STATUS_STYLE[table.status]}`}>
          {table.status === "DRAFT" ? "Draft" : table.status === "APPROVED" ? "Approved" : "Rejected"}
        </span>
      </header>

      {table.forms === null ? (
        <p role="alert" className="rounded-2xl bg-mango-soft px-4 py-3 text-sm">
          ⚠️ The stored forms are not a valid table: {table.formsError}
        </p>
      ) : (
        <ul className="space-y-2">
          {VERB_FORMS.filter((f) => f !== "recent" || table.forms?.recent || inputs.recent).map((form) => {
            const irregular = table.irregular.includes(form);
            const first = parseCell(inputs[form])[0];
            return (
              <li key={form} className={`rounded-2xl px-3 py-2 ${irregular ? "bg-mango-soft" : "bg-seaglass"}`}>
                <label htmlFor={`${id}-${form}`} className="block text-sm font-bold text-ink-soft">
                  {FORM_LABEL[form].en}
                  <span lang="tl" className="ml-2 text-xs font-normal">
                    {FORM_LABEL[form].tl}
                  </span>
                </label>
                <div className="mt-1 flex items-center gap-2">
                  <input
                    id={`${id}-${form}`}
                    lang="tl"
                    value={inputs[form]}
                    onChange={(e) => setInputs({ ...inputs, [form]: e.target.value })}
                    spellCheck={false}
                    autoCapitalize="none"
                    className="min-w-0 flex-1 rounded-xl border-2 border-line bg-surface px-3 py-2 text-lg font-bold outline-none focus:border-lagoon-bright"
                  />
                  {first && <SpeakButton text={first} size="sm" />}
                </div>
                {irregular && <p className="mt-1 text-xs font-bold text-mango-deep">differs from rule</p>}
              </li>
            );
          })}
        </ul>
      )}

      {table.reviewNote && (
        <p className="text-sm text-ink-soft">
          Note{table.reviewedBy ? ` from ${table.reviewedBy}` : ""}: {table.reviewNote}
        </p>
      )}

      <label className="block">
        <span className="sr-only">Review note</span>
        <input
          value={note}
          onChange={(e) => setNote(e.target.value)}
          placeholder="Note for other reviewers (optional)"
          maxLength={500}
          className="w-full rounded-xl border-2 border-line px-3 py-2 text-sm outline-none focus:border-lagoon-bright"
        />
      </label>
      <div className="flex flex-wrap gap-2">
        <Button variant="mango" disabled={pending || !dirty} onClick={save} className="px-4 py-2 text-sm">
          Save
        </Button>
        {table.status !== "APPROVED" && (
          <Button
            disabled={pending || dirty || table.forms === null}
            onClick={() => review("APPROVED")}
            className="px-4 py-2 text-sm"
          >
            Approve
          </Button>
        )}
        {table.status !== "REJECTED" && (
          <Button
            variant="secondary"
            disabled={pending || dirty}
            onClick={() => review("REJECTED")}
            className="px-4 py-2 text-sm"
          >
            Reject
          </Button>
        )}
      </div>
      {dirty && <p className="text-sm text-ink-soft">Save your changes before approving or rejecting.</p>}
      <Message result={result} />
    </section>
  );
}
