"use client";
/**
 * The player for lessons and practice sessions: one exercise at a time, Check → feedback
 * sheet → Continue. Wrong answers go to the back of the queue, so a session ends once every
 * exercise has been answered correctly. The server picks the exercises, grades every answer
 * and owns hearts and XP.
 */
import type { Route } from "next";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import { answerAction, completeLessonAction, startLessonAction, startPracticeAction } from "@/app/actions/lesson";
import type { ClientExercise } from "@/lib/content/client-view";
import type { AnswerFeedback, LessonResult, PracticeScope } from "@/server/lessons";
import { CheckIcon, CloseIcon, HeartIcon } from "@/components/icons";
import { Button } from "@/components/ui";
import {
  Dialogue,
  FillBlank,
  ListenSelect,
  MatchPairs,
  SelectTranslation,
  Speak,
  TypeTranslation,
  WordBank,
} from "./exercises";
import { LessonResults, OutOfHearts } from "./lesson-screens";

type Phase = "starting" | "answering" | "checking" | "feedback" | "finishing" | "done" | "out_of_hearts" | "error";

export type PlaySession = { kind: "lesson"; lessonId: string } | { kind: "practice"; scope: PracticeScope };

export function LessonPlayer({
  session,
  hearts: initialHearts,
  nextHeartAt: initialNext,
  practiceHref = null,
}: {
  session: PlaySession;
  /** Where to practise for a heart when out of hearts (lessons only). */
  practiceHref?: Route | null;
  hearts: number;
  nextHeartAt: string | null;
}) {
  const router = useRouter();
  const [phase, setPhase] = useState<Phase>("starting");
  const [error, setError] = useState<string | null>(null);
  const [attemptId, setAttemptId] = useState<string | null>(null);
  const [exercises, setExercises] = useState<ClientExercise[]>([]);
  const [queue, setQueue] = useState<number[]>([]);
  const [solved, setSolved] = useState(0);
  const [answer, setAnswer] = useState<unknown | null>(null);
  const [feedback, setFeedback] = useState<AnswerFeedback | null>(null);
  const [hearts, setHearts] = useState(initialHearts);
  const [nextHeartAt, setNextHeartAt] = useState(initialNext);
  const [result, setResult] = useState<LessonResult | null>(null);
  const [round, setRound] = useState(0); // remounts the exercise when it comes back around
  const quitRef = useRef<HTMLDialogElement>(null);

  const current: ClientExercise | undefined = exercises[queue[0]];
  const practice = session.kind === "practice";

  // Start exactly one attempt per mount (StrictMode runs effects twice in development).
  const started = useRef(false);
  useEffect(() => {
    if (started.current) return;
    started.current = true;
    const start = session.kind === "lesson" ? startLessonAction(session.lessonId) : startPracticeAction(session.scope);
    start.then((r) => {
      if (r.ok) {
        setAttemptId(r.data.attemptId);
        setExercises(r.data.exercises);
        setQueue(r.data.exercises.map((_, i) => i));
        setPhase("answering");
      } else if (r.code === "no_hearts") setPhase("out_of_hearts");
      else {
        setError(r.message);
        setPhase("error");
      }
    });
  }, [session]);

  const submit = useCallback(
    async (value: unknown) => {
      if (!attemptId || !current) return;
      setPhase("checking");
      const r = await answerAction(attemptId, current.id, value);
      if (!r.ok) {
        setError(r.message);
        setPhase("error");
        return;
      }
      setFeedback(r.data);
      setHearts(r.data.hearts);
      setNextHeartAt(r.data.nextHeartAt);
      setPhase("feedback");
    },
    [attemptId, current],
  );

  const onMatchSolved = useCallback(() => void submit({ completed: true }), [submit]);

  const advance = useCallback(async () => {
    if (!feedback || !attemptId) return;
    if (feedback.outOfHearts) {
      setPhase("out_of_hearts");
      return;
    }
    const [head, ...rest] = queue;
    const nextQueue = feedback.correct ? rest : [...rest, head];
    const nextSolved = feedback.correct ? solved + 1 : solved;
    setQueue(nextQueue);
    setSolved(nextSolved);
    setAnswer(null);
    setFeedback(null);
    setRound((n) => n + 1);
    if (nextQueue.length > 0) {
      setPhase("answering");
      return;
    }
    setPhase("finishing");
    const r = await completeLessonAction(attemptId);
    if (r.ok) {
      setResult(r.data);
      setPhase("done");
      router.refresh();
    } else {
      setError(r.message);
      setPhase("error");
    }
  }, [feedback, attemptId, queue, solved, router]);

  // Enter checks or continues.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Enter" || e.repeat) return;
      if (phase === "answering" && answer !== null && current?.type !== "match_pairs") {
        e.preventDefault();
        void submit(answer);
      } else if (phase === "feedback") {
        e.preventDefault();
        void advance();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [phase, answer, current, submit, advance]);

  if (phase === "out_of_hearts") return <OutOfHearts nextHeartAt={nextHeartAt} practiceHref={practiceHref} />;
  if (phase === "done" && result) return <LessonResults result={result} total={exercises.length} />;

  const progress = exercises.length ? Math.round((solved / exercises.length) * 100) : 0;
  const locked = phase !== "answering";

  return (
    <div className="flex min-h-dvh flex-col bg-surface">
      <header className="mx-auto flex w-full max-w-3xl items-center gap-4 px-4 pt-5 sm:px-6">
        <button
          type="button"
          onClick={() => quitRef.current?.showModal()}
          className="rounded-xl p-1.5 text-ink-soft hover:bg-seaglass"
          aria-label={practice ? "Quit practice" : "Quit lesson"}
        >
          <CloseIcon />
        </button>
        <div
          className="h-4 flex-1 overflow-hidden rounded-full bg-line"
          role="progressbar"
          aria-label="Lesson progress"
          aria-valuenow={progress}
          aria-valuemin={0}
          aria-valuemax={100}
        >
          <div
            className="h-full rounded-full bg-lagoon-bright transition-[width] duration-500"
            style={{ width: `${Math.max(progress, 3)}%` }}
          />
        </div>
        <span
          className="inline-flex items-center gap-1 text-lg font-bold text-gumamela"
          aria-label={`${hearts} hearts`}
        >
          <HeartIcon size={24} />
          {hearts}
        </span>
      </header>

      <main className="mx-auto w-full max-w-2xl flex-1 px-5 pb-48 pt-8 sm:pt-12">
        {phase === "starting" && (
          <p className="text-ink-soft">{practice ? "Picking exercises to practise…" : "Getting your lesson ready…"}</p>
        )}
        {phase === "error" && (
          <div role="alert" className="space-y-4 rounded-3xl bg-gumamela-soft p-6">
            <p className="font-bold text-gumamela">{error}</p>
            <Link href="/learn" className="font-bold text-lagoon underline">
              Back to the path
            </Link>
          </div>
        )}
        {current && phase !== "starting" && phase !== "error" && (
          <div key={`${current.id}-${round}`} data-exercise-id={current.id}>
            {current.type === "select_translation" && (
              <SelectTranslation exercise={current} disabled={locked} onChange={setAnswer} />
            )}
            {current.type === "fill_blank" && <FillBlank exercise={current} disabled={locked} onChange={setAnswer} />}
            {current.type === "word_bank" && <WordBank exercise={current} disabled={locked} onChange={setAnswer} />}
            {current.type === "type_translation" && (
              <TypeTranslation exercise={current} disabled={locked} onChange={setAnswer} />
            )}
            {current.type === "match_pairs" && (
              <MatchPairs exercise={current} disabled={locked} onSolved={onMatchSolved} />
            )}
            {current.type === "listen_select" && (
              <ListenSelect exercise={current} disabled={locked} onChange={setAnswer} />
            )}
            {current.type === "speak" && (
              <Speak exercise={current} disabled={locked} onChange={setAnswer} onSubmit={(a) => void submit(a)} />
            )}
            {current.type === "dialogue" && <Dialogue exercise={current} disabled={locked} onChange={setAnswer} />}
          </div>
        )}
      </main>

      <Footer
        phase={phase}
        feedback={feedback}
        canCheck={answer !== null && current?.type !== "match_pairs"}
        onCheck={() => void submit(answer)}
        onContinue={() => void advance()}
        isMatch={current?.type === "match_pairs"}
      />

      <dialog ref={quitRef} className="m-auto max-w-sm rounded-3xl border-2 border-line p-6 backdrop:bg-ink/40">
        <h2 className="font-display text-2xl">{practice ? "Stop practising?" : "Quit this lesson?"}</h2>
        <p className="mt-2 text-ink-soft">
          {practice
            ? "You won’t get the XP or the heart for this session."
            : "You’ll lose your progress in this lesson. Hearts you’ve lost stay lost."}
        </p>
        <div className="mt-6 grid gap-3">
          <Button onClick={() => quitRef.current?.close()}>Keep learning</Button>
          <Button variant="secondary" onClick={() => router.push("/learn")}>
            {practice ? "Stop practising" : "Quit lesson"}
          </Button>
        </div>
      </dialog>
    </div>
  );
}

function Footer({
  phase,
  feedback,
  canCheck,
  onCheck,
  onContinue,
  isMatch,
}: {
  phase: Phase;
  feedback: AnswerFeedback | null;
  canCheck: boolean;
  onCheck: () => void;
  onContinue: () => void;
  isMatch: boolean;
}) {
  if (phase === "feedback" && feedback) {
    const good = feedback.correct;
    return (
      <div
        role="status"
        aria-live="polite"
        className={`fixed inset-x-0 bottom-0 animate-sheet-up border-t-2 pb-[env(safe-area-inset-bottom)] ${good ? "border-lagoon-bright/40 bg-lagoon-soft" : "border-gumamela/40 bg-gumamela-soft"}`}
      >
        <div className="mx-auto flex max-w-3xl flex-col gap-4 px-5 py-5 sm:flex-row sm:items-center sm:justify-between sm:px-6">
          <div className="flex items-start gap-3">
            <span className={`mt-0.5 rounded-full p-1.5 text-white ${good ? "bg-lagoon-bright" : "bg-gumamela"}`}>
              {good ? <CheckIcon size={22} /> : <CloseIcon size={22} />}
            </span>
            <div>
              <p className={`font-display text-2xl ${good ? "text-lagoon" : "text-gumamela"}`}>
                {feedback.skipped
                  ? "No problem, we’ll practise speaking later."
                  : good
                    ? feedback.typo
                      ? "Almost perfect!"
                      : "Magaling!"
                    : isMatch
                      ? "Not quite"
                      : "Correct answer:"}
              </p>
              {good && feedback.typo && <p className="text-lagoon">Watch the spelling: {feedback.correctAnswer}</p>}
              {!good && !isMatch && (
                <p lang="tl" className="text-lg font-bold text-gumamela">
                  {feedback.correctAnswer}
                </p>
              )}
              {!good && feedback.outOfHearts && (
                <p className="mt-1 font-bold text-gumamela">That was your last heart.</p>
              )}
            </div>
          </div>
          <Button variant={good ? "primary" : "danger"} onClick={onContinue} className="sm:min-w-40" autoFocus>
            Continue
          </Button>
        </div>
      </div>
    );
  }
  return (
    <div className="fixed inset-x-0 bottom-0 border-t-2 border-line bg-surface pb-[env(safe-area-inset-bottom)]">
      <div className="mx-auto flex max-w-3xl justify-end px-5 py-5 sm:px-6">
        {isMatch ? (
          <p className="py-3 text-ink-soft">Tap a word, then its meaning.</p>
        ) : (
          <Button
            onClick={onCheck}
            disabled={!canCheck || phase !== "answering"}
            className="w-full sm:w-auto sm:min-w-40"
          >
            {phase === "checking" ? "Checking…" : phase === "finishing" ? "Saving…" : "Check"}
          </Button>
        )}
      </div>
    </div>
  );
}
