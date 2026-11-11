/**
 * Reviewer preview of an exercise: shows it the way a learner would see it, with the correct
 * answer(s) marked, so a reviewer can judge it without reading JSON.
 */
import type { ParsedExercise } from "@/lib/content/schema";

const TYPE_LABEL: Record<ParsedExercise["type"], string> = {
  select_translation: "Pick the meaning",
  fill_blank: "Fill in the blank",
  word_bank: "Build with tiles",
  match_pairs: "Match pairs",
  type_translation: "Type the translation",
  listen_select: "Listen and pick",
  speak: "Say it aloud",
  dialogue: "Dialogue reply",
};

export function typeLabel(t: ParsedExercise["type"]) {
  return TYPE_LABEL[t];
}

function Choice({ text, correct }: { text: string; correct: boolean }) {
  return (
    <li
      className={`rounded-xl border-2 px-3 py-1.5 ${correct ? "border-lagoon-bright bg-lagoon-soft font-bold text-lagoon" : "border-line"}`}
    >
      {correct && <span className="sr-only">Correct: </span>}
      {text}
    </li>
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
              <Choice key={i} text={o} correct={i === ex.payload.answerIndex} />
            ))}
          </ul>
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
              <Choice key={i} text={o} correct={i === ex.payload.answerIndex} />
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
              <Choice key={i} text={o} correct={i === ex.payload.answerIndex} />
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
              <Choice key={i} text={o} correct={i === ex.payload.answerIndex} />
            ))}
          </ul>
          <p className="text-sm text-ink-soft">Reply means: {ex.payload.replyEn}</p>
        </div>
      );
  }
}
