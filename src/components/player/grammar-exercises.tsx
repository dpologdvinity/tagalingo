/**
 * The four grammar drills (client components, rendered by the LessonPlayer): conjugate, find the
 * root, transform a sentence, and fill a verb table. Like the other exercises they report their
 * current answer through `onChange` (null = not ready to check) and send the shapes the server
 * grades: `{ text }`, `{ choice }`, `{ tokens }` and `{ cells: { [form]: value } }`.
 */
import { useState } from "react";
import { FORM_LABEL, type VerbForm } from "@/lib/grammar/types";
import { Instruction, Options, PromptBubble, type Props } from "./exercises";

const inputClass =
  "rounded-2xl border-2 border-line bg-surface px-4 py-3 text-xl outline-none focus:border-lagoon-bright disabled:opacity-70";

const tileClass =
  "rounded-xl border-2 border-line bg-surface px-3 py-2 text-lg font-bold shadow-press active:translate-y-[2px] active:shadow-none";

/** Tiles to tap, by index so repeated words stay independent; placed tiles leave a ghost behind. */
function TileBank({
  tiles,
  used,
  onPick,
  disabled,
}: {
  tiles: string[];
  used: ReadonlySet<number>;
  onPick: (i: number) => void;
  disabled: boolean;
}) {
  return (
    <div aria-label="Word bank" className="flex flex-wrap justify-center gap-2">
      {tiles.map((t, i) =>
        used.has(i) ? (
          <span key={i} aria-hidden className="rounded-xl bg-line px-3 py-2 text-lg font-bold text-transparent">
            {t}
          </span>
        ) : (
          <button key={i} type="button" lang="tl" disabled={disabled} onClick={() => onPick(i)} className={tileClass}>
            {t}
          </button>
        ),
      )}
    </div>
  );
}

/** A one-line typed answer; Enter is left to the player, which checks it. */
function TextAnswer({
  label,
  disabled,
  onChange,
}: {
  label: string;
  disabled: boolean;
  onChange: (answer: unknown | null) => void;
}) {
  const [text, setText] = useState("");
  return (
    <input
      autoFocus
      type="text"
      aria-label={label}
      lang="tl"
      value={text}
      disabled={disabled}
      autoCapitalize="off"
      autoCorrect="off"
      spellCheck={false}
      placeholder="Type in Tagalog"
      onChange={(e) => {
        setText(e.target.value);
        onChange(e.target.value.trim() ? { text: e.target.value } : null);
      }}
      className={`w-full ${inputClass}`}
    />
  );
}

/** Type the inflected verb that fills the blank; the root is shown after it. */
export function Conjugate({ exercise, disabled, onChange }: Props<"conjugate">) {
  const [before, after] = exercise.sentence.split("___");
  return (
    <div className="space-y-6">
      <Instruction>{`Make it ${FORM_LABEL[exercise.form].en}`}</Instruction>
      <div className="space-y-2">
        <p lang="tl" className="text-2xl font-bold leading-relaxed">
          {before}
          <span className="mx-1 inline-block w-48 align-middle">
            <TextAnswer label="Your answer" disabled={disabled} onChange={onChange} />
          </span>
          <span className="text-ink-soft">({exercise.root})</span>
          {after}
        </p>
        <p className="text-lg text-ink-soft">“{exercise.translation}”</p>
      </div>
    </div>
  );
}

/** Name the root of an inflected word, by choosing it or typing it. */
export function FindRoot({ exercise, disabled, onChange }: Props<"find_root">) {
  const [selected, setSelected] = useState<number | null>(null);
  const options = exercise.mode === "choice" ? (exercise.options ?? []) : null;
  return (
    <div className="space-y-6">
      <Instruction>{"What's the root?"}</Instruction>
      <PromptBubble text={exercise.word} lang="tl" />
      {exercise.translation && <p className="text-lg text-ink-soft">“{exercise.translation}”</p>}
      {options ? (
        <Options
          options={options}
          selected={selected}
          onSelect={(i) => {
            setSelected(i);
            onChange({ choice: i });
          }}
          disabled={disabled}
          lang="tl"
        />
      ) : (
        <TextAnswer label="The root" disabled={disabled} onChange={onChange} />
      )}
    </div>
  );
}

/** Rewrite a sentence as instructed, by building it from tiles or typing it. */
export function Transform({ exercise, disabled, onChange }: Props<"transform">) {
  const tiles = exercise.tiles ?? [];
  const [placed, setPlaced] = useState<number[]>([]);
  const toggle = (i: number) => {
    if (disabled) return;
    const next = placed.includes(i) ? placed.filter((p) => p !== i) : [...placed, i];
    setPlaced(next);
    onChange(next.length ? { tokens: next.map((p) => tiles[p]) } : null);
  };
  return (
    <div className="space-y-6">
      <Instruction>{exercise.instruction}</Instruction>
      <div className="space-y-2">
        <PromptBubble text={exercise.source} lang="tl" />
        <p className="text-lg text-ink-soft">“{exercise.sourceEn}”</p>
      </div>
      {exercise.mode === "type" ? (
        <TextAnswer label="Your answer" disabled={disabled} onChange={onChange} />
      ) : (
        <>
          <div
            aria-label="Your answer"
            className="flex min-h-[5.5rem] flex-wrap content-start gap-2 border-y-2 border-line py-3"
          >
            {placed.map((i) => (
              <button
                key={i}
                type="button"
                lang="tl"
                disabled={disabled}
                onClick={() => toggle(i)}
                className={tileClass}
              >
                {tiles[i]}
              </button>
            ))}
          </div>
          <TileBank tiles={tiles} used={new Set(placed)} onPick={toggle} disabled={disabled} />
        </>
      )}
    </div>
  );
}

/**
 * A verb's form table with some cells hidden. Tapping a tile fills the next empty hidden cell;
 * tapping a filled cell returns its tile. `wrongCells` (set during feedback) marks the cells the
 * server found wrong.
 */
export function Paradigm({
  exercise,
  disabled,
  onChange,
  wrongCells = null,
}: Props<"paradigm"> & { wrongCells?: VerbForm[] | null }) {
  const hidden = exercise.cells.filter((c) => c.value === null).map((c) => c.form);
  // Form -> index of the tile sitting in that cell.
  const [filled, setFilled] = useState<Partial<Record<VerbForm, number>>>({});

  const update = (next: Partial<Record<VerbForm, number>>) => {
    setFilled(next);
    const complete = hidden.every((f) => next[f] !== undefined);
    onChange(
      complete ? { cells: Object.fromEntries(hidden.map((f) => [f, exercise.tiles[next[f] as number]])) } : null,
    );
  };
  const pick = (tile: number) => {
    if (disabled) return;
    const slot = hidden.find((f) => filled[f] === undefined);
    if (slot) update({ ...filled, [slot]: tile });
  };
  const clear = (form: VerbForm) => {
    if (disabled) return;
    const rest = { ...filled };
    delete rest[form];
    update(rest);
  };

  return (
    <div className="space-y-6">
      <Instruction>Fill in the verb table</Instruction>
      <p className="text-lg text-ink-soft">
        <span lang="tl" className="font-bold text-ink">
          {exercise.root}
        </span>{" "}
        “{exercise.en}”
      </p>
      <dl className="grid grid-cols-[auto_1fr] items-stretch gap-x-4 gap-y-2">
        {exercise.cells.map(({ form, value }) => {
          const tile = filled[form];
          const wrong = wrongCells?.includes(form) ?? false;
          return (
            <div key={form} className="contents">
              <dt className="self-center text-ink-soft">
                {FORM_LABEL[form].en}
                <span lang="tl" className="block text-sm">
                  {FORM_LABEL[form].tl}
                </span>
              </dt>
              <dd>
                {value !== null ? (
                  <span lang="tl" className="block rounded-2xl bg-seaglass px-4 py-3 text-xl font-bold">
                    {value}
                  </span>
                ) : (
                  <button
                    type="button"
                    lang="tl"
                    aria-label={`${FORM_LABEL[form].en} cell`}
                    disabled={disabled || tile === undefined}
                    onClick={() => clear(form)}
                    className={`block min-h-[3.25rem] w-full rounded-2xl border-2 px-4 py-3 text-left text-xl font-bold ${
                      wrong
                        ? "border-gumamela bg-gumamela-soft text-gumamela"
                        : tile === undefined
                          ? "border-dashed border-line text-transparent"
                          : "border-lagoon-bright bg-lagoon-soft text-lagoon"
                    }`}
                  >
                    {tile === undefined ? "____" : exercise.tiles[tile]}
                  </button>
                )}
              </dd>
            </div>
          );
        })}
      </dl>
      <TileBank tiles={exercise.tiles} used={new Set(Object.values(filled))} onPick={pick} disabled={disabled} />
    </div>
  );
}
