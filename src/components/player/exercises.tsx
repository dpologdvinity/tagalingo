/**
 * The five exercise types (client components; rendered inside the client-side LessonPlayer). Each reports its current answer through `onChange` (null = not ready
 * to check yet). The player owns checking, feedback and progression.
 */
import { useEffect, useMemo, useRef, useState } from "react";
import type { ClientExercise } from "@/lib/content/client-view";
import { hash, rng, shuffle } from "@/lib/random";
import { useRecognitionSupported, useSpeechRecognition } from "@/lib/speech/client";
import { SpeakButton } from "@/components/speak-button";

type Of<T extends ClientExercise["type"]> = Extract<ClientExercise, { type: T }>;
type Props<T extends ClientExercise["type"]> = {
  exercise: Of<T>;
  disabled: boolean;
  onChange: (answer: unknown | null) => void;
};

const langName = (l: "tl" | "en") => (l === "tl" ? "Tagalog" : "English");

function Instruction({ children }: { children: React.ReactNode }) {
  return <h2 className="font-display text-2xl text-ink sm:text-3xl">{children}</h2>;
}

function PromptBubble({ text, lang }: { text: string; lang: "tl" | "en" }) {
  return (
    <div className="flex flex-wrap items-center gap-3">
      {lang === "tl" && <SpeakButton text={text} />}
      <p
        lang={lang === "tl" ? "tl" : "en"}
        className="inline-block rounded-3xl border-2 border-line bg-surface px-5 py-4 text-xl font-bold sm:text-2xl"
      >
        {text}
      </p>
    </div>
  );
}

/** Numbered options; keys 1–4 select. */
function Options({
  options,
  selected,
  onSelect,
  disabled,
  lang,
}: {
  options: string[];
  selected: number | null;
  onSelect: (i: number) => void;
  disabled: boolean;
  lang?: "tl" | "en";
}) {
  useEffect(() => {
    if (disabled) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;
      const n = Number(e.key);
      if (n >= 1 && n <= options.length) onSelect(n - 1);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [disabled, options.length, onSelect]);

  return (
    <div role="radiogroup" className="grid gap-3">
      {options.map((o, i) => {
        const active = selected === i;
        return (
          <button
            key={`${o}-${i}`}
            type="button"
            role="radio"
            aria-checked={active}
            disabled={disabled}
            onClick={() => onSelect(i)}
            lang={lang}
            className={`flex items-center gap-3 rounded-2xl border-2 px-4 py-3.5 text-left text-lg font-bold transition-[transform,box-shadow] active:translate-y-[2px] ${
              active
                ? "border-lagoon-bright bg-lagoon-soft text-lagoon shadow-press-lagoon"
                : "border-line bg-surface shadow-press"
            }`}
          >
            <span
              aria-hidden
              className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-lg border-2 text-sm ${active ? "border-lagoon-bright" : "border-line text-ink-soft"}`}
            >
              {i + 1}
            </span>
            {o}
          </button>
        );
      })}
    </div>
  );
}

export function SelectTranslation({ exercise, disabled, onChange }: Props<"select_translation">) {
  const [selected, setSelected] = useState<number | null>(null);
  const select = (i: number) => {
    setSelected(i);
    onChange({ choice: i });
  };
  const target = exercise.promptLang === "tl" ? "en" : "tl";
  const isSentence = exercise.prompt.trim().includes(" ") && /[.?!]$/.test(exercise.prompt.trim());
  return (
    <div className="space-y-6">
      <Instruction>
        {isSentence
          ? "What does this sentence mean?"
          : exercise.promptLang === "tl"
            ? "What does this mean?"
            : `How do you say this in ${langName(target)}?`}
      </Instruction>
      <PromptBubble text={exercise.prompt} lang={exercise.promptLang} />
      <Options options={exercise.options} selected={selected} onSelect={select} disabled={disabled} lang={target} />
    </div>
  );
}

export function FillBlank({ exercise, disabled, onChange }: Props<"fill_blank">) {
  const [selected, setSelected] = useState<number | null>(null);
  const select = (i: number) => {
    setSelected(i);
    onChange({ choice: i });
  };
  const [before, after] = exercise.sentence.split("___");
  return (
    <div className="space-y-6">
      <Instruction>Fill in the blank</Instruction>
      <div className="space-y-2">
        <p lang="tl" className="text-2xl font-bold leading-relaxed">
          {before}
          <span
            className={`mx-1 inline-block min-w-24 border-b-4 px-2 text-center ${selected !== null ? "border-lagoon-bright text-lagoon" : "border-line text-transparent"}`}
          >
            {selected !== null ? exercise.options[selected] : "____"}
          </span>
          {after}
        </p>
        <p className="text-lg text-ink-soft">“{exercise.translation}”</p>
      </div>
      <Options options={exercise.options} selected={selected} onSelect={select} disabled={disabled} lang="tl" />
    </div>
  );
}

export function WordBank({ exercise, disabled, onChange }: Props<"word_bank">) {
  // Track tiles by index so repeated words are independent.
  const [placed, setPlaced] = useState<number[]>([]);
  const toggle = (i: number) => {
    if (disabled) return;
    const next = placed.includes(i) ? placed.filter((p) => p !== i) : [...placed, i];
    setPlaced(next);
    onChange(next.length ? { tokens: next.map((p) => exercise.tiles[p]) } : null);
  };
  const target = exercise.promptLang === "tl" ? "en" : "tl";
  const tile =
    "rounded-xl border-2 border-line bg-surface px-3 py-2 text-lg font-bold shadow-press active:translate-y-[2px] active:shadow-none";
  return (
    <div className="space-y-6">
      <Instruction>Translate into {langName(target)}</Instruction>
      <PromptBubble text={exercise.prompt} lang={exercise.promptLang} />
      <div
        aria-label="Your answer"
        className="flex min-h-[7.5rem] flex-wrap content-start gap-2 border-y-2 border-line py-3"
        style={{
          backgroundImage:
            "linear-gradient(transparent 3.6rem, var(--color-line) 3.6rem, var(--color-line) calc(3.6rem + 2px), transparent calc(3.6rem + 2px))",
        }}
      >
        {placed.map((i) => (
          <button key={i} type="button" lang={target} disabled={disabled} onClick={() => toggle(i)} className={tile}>
            {exercise.tiles[i]}
          </button>
        ))}
      </div>
      <div aria-label="Word bank" className="flex flex-wrap justify-center gap-2">
        {exercise.tiles.map((t, i) =>
          placed.includes(i) ? (
            <span key={i} aria-hidden className="rounded-xl bg-line px-3 py-2 text-lg font-bold text-transparent">
              {t}
            </span>
          ) : (
            <button key={i} type="button" lang={target} disabled={disabled} onClick={() => toggle(i)} className={tile}>
              {t}
            </button>
          ),
        )}
      </div>
    </div>
  );
}

export function TypeTranslation({ exercise, disabled, onChange }: Props<"type_translation">) {
  const [text, setText] = useState("");
  const target = exercise.promptLang === "tl" ? "en" : "tl";
  return (
    <div className="space-y-6">
      <Instruction>Type this in {langName(target)}</Instruction>
      <PromptBubble text={exercise.prompt} lang={exercise.promptLang} />
      <label className="block">
        <span className="sr-only">Your translation</span>
        <textarea
          autoFocus
          rows={3}
          value={text}
          lang={target}
          disabled={disabled}
          autoCapitalize="off"
          autoCorrect="off"
          spellCheck={false}
          placeholder={`Type in ${langName(target)}`}
          onChange={(e) => {
            setText(e.target.value);
            onChange(e.target.value.trim() ? { text: e.target.value } : null);
          }}
          onKeyDown={(e) => {
            // Enter checks (handled by the player); Shift+Enter is never needed for short answers.
            if (e.key === "Enter") e.preventDefault();
          }}
          className="w-full resize-none rounded-2xl border-2 border-line bg-surface p-4 text-xl outline-none focus:border-lagoon-bright"
        />
      </label>
    </div>
  );
}

/** Tap a Tagalog word, then its meaning. Mistakes shake but cost nothing. */
export function MatchPairs({
  exercise,
  disabled,
  onSolved,
}: {
  exercise: Of<"match_pairs">;
  disabled: boolean;
  onSolved: () => void;
}) {
  const rights = useMemo(
    () =>
      shuffle(
        exercise.pairs.map((p) => p.en),
        rng(hash(exercise.id + ":r")),
      ),
    [exercise],
  );
  const lefts = useMemo(
    () =>
      shuffle(
        exercise.pairs.map((p) => p.tl),
        rng(hash(exercise.id + ":l")),
      ),
    [exercise],
  );
  const [left, setLeft] = useState<string | null>(null);
  const [right, setRight] = useState<string | null>(null);
  const [matched, setMatched] = useState<Set<string>>(new Set());
  const [wrong, setWrong] = useState<[string, string] | null>(null);

  /** Select a word on one side; once both sides are chosen, check the pair right away. */
  const pick = (side: "tl" | "en", value: string) => {
    const tl = side === "tl" ? value : left;
    const en = side === "en" ? value : right;
    if (!tl || !en) {
      if (side === "tl") setLeft(value);
      else setRight(value);
      return;
    }
    setLeft(null);
    setRight(null);
    if (exercise.pairs.some((p) => p.tl === tl && p.en === en)) {
      const next = new Set(matched).add(tl);
      setMatched(next);
      if (next.size === exercise.pairs.length) onSolved();
    } else setWrong([tl, en]);
  };

  useEffect(() => {
    if (!wrong) return;
    const t = setTimeout(() => setWrong(null), 400);
    return () => clearTimeout(t);
  }, [wrong]);

  const enDone = (en: string) => exercise.pairs.some((p) => p.en === en && matched.has(p.tl));
  const cell = (active: boolean, done: boolean, shaking: boolean) =>
    `w-full rounded-2xl border-2 px-3 py-3.5 text-lg font-bold transition-colors ${
      done
        ? "border-line bg-seaglass text-line"
        : shaking
          ? "animate-shake border-gumamela bg-gumamela-soft text-gumamela"
          : active
            ? "border-lagoon-bright bg-lagoon-soft text-lagoon"
            : "border-line bg-surface shadow-press"
    }`;

  return (
    <div className="space-y-6">
      <Instruction>Match the pairs</Instruction>
      <div className="grid grid-cols-2 gap-3">
        <div className="grid gap-3">
          {lefts.map((tl) => (
            <button
              key={tl}
              type="button"
              lang="tl"
              disabled={disabled || matched.has(tl)}
              aria-pressed={left === tl}
              onClick={() => pick("tl", tl)}
              className={cell(left === tl, matched.has(tl), wrong?.[0] === tl)}
            >
              {tl}
            </button>
          ))}
        </div>
        <div className="grid gap-3">
          {rights.map((en) => (
            <button
              key={en}
              type="button"
              disabled={disabled || enDone(en)}
              aria-pressed={right === en}
              onClick={() => pick("en", en)}
              className={cell(right === en, enDone(en), wrong?.[1] === en)}
            >
              {en}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}

/** Hear a Tagalog phrase and pick its meaning. The text can be revealed if audio isn't available. */
export function ListenSelect({ exercise, disabled, onChange }: Props<"listen_select">) {
  const [selected, setSelected] = useState<number | null>(null);
  const [revealed, setRevealed] = useState(false);
  const select = (i: number) => {
    setSelected(i);
    onChange({ choice: i });
  };
  return (
    <div className="space-y-6">
      <Instruction>What do you hear?</Instruction>
      <div className="flex flex-wrap items-center gap-4">
        <SpeakButton text={exercise.audio} size="lg" label="Play the phrase" />
        <SpeakButton text={exercise.audio} slow label="Play the phrase slowly" />
        {revealed || disabled ? (
          <p lang="tl" className="text-xl font-bold">
            {exercise.audio}
          </p>
        ) : (
          <button type="button" onClick={() => setRevealed(true)} className="text-sm font-bold text-lagoon underline">
            Can’t listen now? Show the text
          </button>
        )}
      </div>
      <Options options={exercise.options} selected={selected} onSelect={select} disabled={disabled} lang="en" />
    </div>
  );
}

/** See a Tagalog word and pick its picture. */
export function SelectPicture({ exercise, disabled, onChange }: Props<"select_picture">) {
  const [selected, setSelected] = useState<number | null>(null);
  const select = (i: number) => {
    setSelected(i);
    onChange({ choice: i });
  };
  const count = exercise.pictures.length;
  useEffect(() => {
    if (disabled) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;
      const n = Number(e.key);
      if (n >= 1 && n <= count) {
        setSelected(n - 1);
        onChange({ choice: n - 1 });
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [disabled, count, onChange]);
  return (
    <div className="space-y-6">
      <Instruction>Which picture shows this?</Instruction>
      <PromptBubble text={exercise.prompt} lang="tl" />
      <div role="radiogroup" aria-label="Pictures" className="grid grid-cols-2 gap-3">
        {exercise.pictures.map((pic, i) => (
          <button
            key={`${pic}-${i}`}
            type="button"
            role="radio"
            aria-checked={selected === i}
            disabled={disabled}
            onClick={() => select(i)}
            className={`flex aspect-[4/3] items-center justify-center rounded-3xl border-2 text-6xl transition-[transform,box-shadow] active:translate-y-[2px] sm:text-7xl ${
              selected === i
                ? "border-lagoon-bright bg-lagoon-soft shadow-press-lagoon"
                : "border-line bg-surface shadow-press"
            }`}
          >
            {/* Screen readers announce the emoji's name, the same information sighted learners get. */}
            <span className="sr-only">Picture {i + 1}: </span>
            <span>{pic}</span>
          </button>
        ))}
      </div>
    </div>
  );
}

/** Say a sentence aloud; graded on the transcript. "Can't speak now" skips without penalty. */
export function Speak({
  exercise,
  disabled,
  onChange,
  onSubmit,
}: Props<"speak"> & { onSubmit: (answer: unknown) => void }) {
  const supported = useRecognitionSupported();
  const { listen, stop } = useSpeechRecognition();
  const [state, setState] = useState<"idle" | "listening" | "heard" | "error">("idle");
  const [transcript, setTranscript] = useState("");
  // Once this exercise is gone (or skipped), a late transcript must not leak into the next one.
  const active = useRef(true);
  useEffect(() => {
    active.current = true;
    return () => {
      active.current = false;
      stop();
    };
  }, [stop]);

  const skip = () => {
    active.current = false;
    stop();
    onChange(null);
    onSubmit({ skipped: true });
  };

  const record = async () => {
    setState("listening");
    try {
      const heard = await listen();
      if (!active.current) return;
      setTranscript(heard);
      setState(heard ? "heard" : "error");
      onChange(heard ? { transcript: heard } : null);
    } catch {
      if (!active.current) return;
      setState("error");
      onChange(null);
    }
  };

  return (
    <div className="space-y-6">
      <Instruction>Say this sentence</Instruction>
      <PromptBubble text={exercise.text} lang="tl" />
      <p className="text-lg text-ink-soft">“{exercise.translation}”</p>
      {supported ? (
        <div className="flex flex-col items-center gap-3">
          <button
            type="button"
            onClick={record}
            disabled={disabled || state === "listening"}
            className={`flex h-24 w-24 items-center justify-center rounded-full text-white shadow-press-lagoon active:translate-y-[2px] ${
              state === "listening" ? "animate-pulse bg-gumamela" : "bg-lagoon-bright"
            }`}
            aria-label={state === "listening" ? "Listening" : "Tap and speak"}
          >
            <svg width="40" height="40" viewBox="0 0 24 24" aria-hidden>
              <path
                fill="currentColor"
                d="M12 14a3 3 0 0 0 3-3V5a3 3 0 0 0-6 0v6a3 3 0 0 0 3 3zm5-3a5 5 0 0 1-10 0H5a7 7 0 0 0 6 6.9V21h2v-3.1A7 7 0 0 0 19 11h-2z"
              />
            </svg>
          </button>
          <p role="status" className="min-h-6 text-center font-bold text-ink-soft">
            {state === "listening"
              ? "Listening… speak now"
              : state === "heard"
                ? `We heard: “${transcript}”`
                : state === "error"
                  ? "We didn’t catch that. Tap to try again."
                  : "Tap the microphone and speak"}
          </p>
        </div>
      ) : (
        <p className="rounded-2xl bg-seaglass px-4 py-3 text-ink-soft">
          Speech recognition isn’t available in this browser. Say it out loud anyway, then continue.
        </p>
      )}
      <div className="text-center">
        <button
          type="button"
          disabled={disabled}
          onClick={skip}
          className="font-bold text-lagoon underline-offset-4 hover:underline"
        >
          {supported ? "Can’t speak now" : "Continue"}
        </button>
      </div>
    </div>
  );
}

/** Read a short conversation and choose the next line. */
export function Dialogue({ exercise, disabled, onChange }: Props<"dialogue">) {
  const [selected, setSelected] = useState<number | null>(null);
  const select = (i: number) => {
    setSelected(i);
    onChange({ choice: i });
  };
  return (
    <div className="space-y-6">
      <Instruction>Choose the best reply</Instruction>
      <ol className="space-y-3">
        {exercise.lines.map((line, i) => (
          <li key={i} className={`flex items-end gap-2 ${line.speaker === "B" ? "flex-row-reverse" : ""}`}>
            <span
              aria-hidden
              className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-full font-bold text-white ${
                line.speaker === "A" ? "bg-mango-deep" : "bg-lagoon"
              }`}
            >
              {line.speaker}
            </span>
            <div
              className={`max-w-[80%] rounded-3xl border-2 px-4 py-2.5 ${
                line.speaker === "A"
                  ? "rounded-bl-md border-mango/50 bg-mango-soft"
                  : "rounded-br-md border-line bg-surface"
              }`}
            >
              <p lang="tl" className="flex items-center gap-2 text-lg font-bold">
                {line.tl} <SpeakButton text={line.tl} size="sm" />
              </p>
              <p className="text-sm text-ink-soft">{line.en}</p>
            </div>
          </li>
        ))}
        <li className="flex flex-row-reverse items-end gap-2">
          <span
            aria-hidden
            className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-lagoon font-bold text-white"
          >
            B
          </span>
          <div className="rounded-3xl rounded-br-md border-2 border-dashed border-line px-4 py-2.5 text-lg font-bold text-ink-soft">
            {selected !== null ? <span lang="tl">{exercise.options[selected]}</span> : "…"}
          </div>
        </li>
      </ol>
      <Options options={exercise.options} selected={selected} onSelect={select} disabled={disabled} lang="tl" />
    </div>
  );
}
