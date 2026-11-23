/**
 * Reviewer preview of an exercise: shows it the way a learner would see it, with the correct
 * answer(s) marked, so a reviewer can judge it without reading JSON.
 */
import type { ParsedExercise } from "@/lib/content/schema";
import { FORM_LABEL } from "@/lib/grammar/types";

const TYPE_LABEL: Record<ParsedExercise["type"], string> = {
  select_translation: "Pick the meaning",
  fill_blank: "Fill in the blank",
  word_bank: "Build with tiles",
  match_pairs: "Match pairs",
  type_translation: "Type the translation",
  listen_select: "Listen and pick",
  speak: "Say it aloud",
  dialogue: "Dialogue reply",
  conjugate: "Conjugate",
  find_root: "Find the root",
  transform: "Transform",
  paradigm: "Complete the table",
};

export function typeLabel(t: ParsedExercise["type"]) {
  return TYPE_LABEL[t];
}

function Choice({ text, correct, why }: { text: string; correct: boolean; why?: string | null }) {
  return (
    <li
      className={`rounded-xl border-2 px-3 py-1.5 ${correct ? "border-lagoon-bright bg-lagoon-soft font-bold text-lagoon" : "border-line"}`}
    >
      {correct && <span className="sr-only">Correct: </span>}
      {text}
      {why && <span className="block text-sm font-normal text-ink-soft">Why not: {why}</span>}
    </li>
  );
}

/** The hint a learner can open before answering. */
function Hint({ text }: { text?: string }) {
  return text ? <p className="text-sm text-ink-soft">Hint: {text}</p> : null;
}

/** Explanations for specific wrong answers: "answer → why". */
function Mistakes({ items }: { items?: { answer: string; why: string }[] }) {
  if (!items?.length) return null;
  return (
    <ul className="space-y-0.5 text-sm">
      {items.map((m) => (
        <li key={m.answer}>
          <span className="text-ink-soft">Mistake: </span>
          <strong lang="tl">{m.answer}</strong> → {m.why}
        </li>
      ))}
    </ul>
  );
}

export function ExercisePreview({ ex }: { ex: ParsedExercise }) {
  switch (ex.type) {
    case "select_translation":
      return (
        <div className="space-y-2">
          <p className="text-lg font-bold" lang={ex.payload.promptLang}>
            {ex.payload.prompt}
          </p>
          <ul className="grid gap-1.5 sm:grid-cols-2">
            {ex.payload.options.map((o, i) => (
              <Choice key={i} text={o} correct={i === ex.payload.answerIndex} why={ex.payload.why?.[i]} />
            ))}
          </ul>
          <Hint text={ex.payload.hint} />
        </div>
      );
    case "fill_blank":
      return (
        <div className="space-y-2">
          <p className="text-lg font-bold" lang="tl">
            {ex.payload.sentence}
          </p>
          <p className="text-ink-soft">“{ex.payload.translation}”</p>
          <ul className="flex flex-wrap gap-1.5">
            {ex.payload.options.map((o, i) => (
              <Choice key={i} text={o} correct={i === ex.payload.answerIndex} why={ex.payload.why?.[i]} />
            ))}
          </ul>
        </div>
      );
    case "word_bank":
      return (
        <div className="space-y-2">
          <p className="text-lg font-bold" lang={ex.payload.promptLang}>
            {ex.payload.prompt}
          </p>
          <p>
            <span className="text-ink-soft">Answer: </span>
            <strong className="text-lagoon">{ex.payload.answer.join(" ")}</strong>
          </p>
          {ex.payload.alternates?.length ? (
            <p>
              <span className="text-ink-soft">Also accepted: </span>
              {ex.payload.alternates.map((a) => a.join(" ")).join(" / ")}
            </p>
          ) : null}
          <p>
            <span className="text-ink-soft">Distractor tiles: </span>
            {ex.payload.distractors.length ? ex.payload.distractors.join(", ") : "none"}
          </p>
        </div>
      );
    case "match_pairs":
      return (
        <ul className="grid gap-1.5 sm:grid-cols-2">
          {ex.payload.pairs.map((p) => (
            <li key={p.tl} className="rounded-xl border-2 border-line px-3 py-1.5">
              <strong lang="tl">{p.tl}</strong> = {p.en}
            </li>
          ))}
        </ul>
      );
    case "type_translation":
      return (
        <div className="space-y-2">
          <p className="text-lg font-bold" lang={ex.payload.promptLang}>
            {ex.payload.prompt}
          </p>
          <p>
            <span className="text-ink-soft">Accepted answers: </span>
            <strong className="text-lagoon">{ex.payload.answers.join(" / ")}</strong>
          </p>
        </div>
      );
    case "listen_select":
      return (
        <div className="space-y-2">
          <p className="text-lg font-bold" lang="tl">
            🔊 {ex.payload.audio}
          </p>
          <ul className="grid gap-1.5 sm:grid-cols-2">
            {ex.payload.options.map((o, i) => (
              <Choice key={i} text={o} correct={i === ex.payload.answerIndex} why={ex.payload.why?.[i]} />
            ))}
          </ul>
        </div>
      );
    case "speak":
      return (
        <div className="space-y-1">
          <p className="text-lg font-bold" lang="tl">
            🎤 {ex.payload.text}
          </p>
          <p className="text-ink-soft">“{ex.payload.translation}”</p>
        </div>
      );
    case "dialogue":
      return (
        <div className="space-y-2">
          <ul className="space-y-1">
            {ex.payload.lines.map((l, i) => (
              <li key={i}>
                <strong>{l.speaker}:</strong> <span lang="tl">{l.tl}</span>{" "}
                <span className="text-ink-soft">({l.en})</span>
              </li>
            ))}
          </ul>
          <ul className="grid gap-1.5">
            {ex.payload.options.map((o, i) => (
              <Choice key={i} text={o} correct={i === ex.payload.answerIndex} why={ex.payload.why?.[i]} />
            ))}
          </ul>
          <p className="text-sm text-ink-soft">Reply means: {ex.payload.replyEn}</p>
        </div>
      );
    case "conjugate":
      return (
        <div className="space-y-2">
          <p className="text-lg font-bold" lang="tl">
            {ex.payload.sentence}
          </p>
          <p className="text-ink-soft">“{ex.payload.translation}”</p>
          <p>
            <strong lang="tl">{ex.payload.root}</strong> · {ex.payload.affix} · {FORM_LABEL[ex.payload.form].en}
          </p>
          <p>
            <span className="text-ink-soft">Accepted answers: </span>
            <strong className="text-lagoon">{ex.payload.answers.join(" / ")}</strong>
          </p>
          <Mistakes items={ex.payload.mistakes} />
        </div>
      );
    case "find_root":
      return (
        <div className="space-y-2">
          <p className="text-lg font-bold" lang="tl">
            {ex.payload.word}
          </p>
          {ex.payload.translation && <p className="text-ink-soft">“{ex.payload.translation}”</p>}
          <p className="text-sm text-ink-soft">{ex.payload.mode === "choice" ? "Pick the root" : "Type the root"}</p>
          {ex.payload.options ? (
            <ul className="flex flex-wrap gap-1.5">
              {ex.payload.options.map((o) => (
                <Choice key={o} text={o} correct={o.trim().toLowerCase() === ex.payload.root.trim().toLowerCase()} />
              ))}
            </ul>
          ) : (
            <p>
              <span className="text-ink-soft">Root: </span>
              <strong className="text-lagoon">{ex.payload.root}</strong>
            </p>
          )}
          <Hint text={ex.payload.hint} />
        </div>
      );
    case "transform":
      return (
        <div className="space-y-2">
          <p className="text-lg font-bold" lang="tl">
            {ex.payload.source}
          </p>
          <p className="text-ink-soft">“{ex.payload.sourceEn}”</p>
          <p>
            <strong>{ex.payload.instruction}</strong>{" "}
            <span className="text-sm text-ink-soft">
              ({ex.payload.mode === "build" ? "build with tiles" : "type it"})
            </span>
          </p>
          <p>
            <span className="text-ink-soft">Accepted answers: </span>
            <strong className="text-lagoon">{ex.payload.answers.map((a) => a.join(" ")).join(" / ")}</strong>
          </p>
          <p>
            <span className="text-ink-soft">Distractor tiles: </span>
            {ex.payload.distractors.length ? ex.payload.distractors.join(", ") : "none"}
          </p>
          <Mistakes items={ex.payload.mistakes} />
        </div>
      );
    case "paradigm":
      return (
        <div className="space-y-2">
          <p>
            <strong lang="tl">{ex.payload.root}</strong> · {ex.payload.affix} · {ex.payload.en}
          </p>
          <ul className="grid gap-1.5 sm:grid-cols-2">
            {ex.payload.cells.map((c) => (
              <li
                key={c.form}
                className={`rounded-xl border-2 px-3 py-1.5 ${c.hidden ? "border-mango bg-mango-soft" : "border-line"}`}
              >
                <span className="block text-xs text-ink-soft">{FORM_LABEL[c.form].en}</span>
                <strong lang="tl">{c.value}</strong>
                {c.hidden && <span className="ml-2 text-xs font-bold text-mango-deep">hidden from the learner</span>}
              </li>
            ))}
          </ul>
          <p>
            <span className="text-ink-soft">Distractor tiles: </span>
            {ex.payload.distractors.length ? ex.payload.distractors.join(", ") : "none"}
          </p>
        </div>
      );
  }
}
