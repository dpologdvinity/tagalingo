"use client";
/**
 * Interactive Studio controls: approve / reject (with an optional note), edit the payload JSON,
 * and generate new drafts for a lesson.
 */
import { useState, useTransition } from "react";
import {
  generateDraftsAction,
  reviewExerciseAction,
  saveExerciseAction,
  type StudioResult,
} from "@/app/actions/studio";
import { Button } from "@/components/ui";

function Message({ result }: { result: StudioResult | null }) {
  if (!result) return null;
  return (
    <p role="status" className={`text-sm font-bold ${result.ok ? "text-lagoon" : "text-gumamela"}`}>
      {result.message}
    </p>
  );
}

export function ReviewControls({
  exerciseId,
  status,
  payload,
}: {
  exerciseId: string;
  status: "DRAFT" | "APPROVED" | "REJECTED";
  payload: unknown;
}) {
  const [pending, start] = useTransition();
  const [result, setResult] = useState<StudioResult | null>(null);
  const [note, setNote] = useState("");
  const [editing, setEditing] = useState(false);
  const [json, setJson] = useState(() => JSON.stringify(payload, null, 2));

  const review = (next: "APPROVED" | "REJECTED" | "DRAFT") =>
    start(async () => setResult(await reviewExerciseAction(exerciseId, next, note)));
  const save = () =>
    start(async () => {
      const r = await saveExerciseAction(exerciseId, json);
      setResult(r);
      if (r.ok) setEditing(false);
    });

  return (
    <div className="space-y-3">
      {editing && (
        <label className="block">
          <span className="mb-1 block text-sm font-bold">Exercise JSON</span>
          <textarea
            value={json}
            onChange={(e) => setJson(e.target.value)}
            rows={Math.min(18, json.split("\n").length + 1)}
            spellCheck={false}
            className="w-full rounded-2xl border-2 border-line bg-seaglass p-3 font-mono text-sm outline-none focus:border-lagoon-bright"
          />
        </label>
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
        {status !== "APPROVED" && (
          <Button disabled={pending} onClick={() => review("APPROVED")} className="px-4 py-2 text-sm">
            Approve
          </Button>
        )}
        {status !== "REJECTED" && (
          <Button
            variant="secondary"
            disabled={pending}
            onClick={() => review("REJECTED")}
            className="px-4 py-2 text-sm"
          >
            Reject
          </Button>
        )}
        {status !== "DRAFT" && (
          <Button variant="ghost" disabled={pending} onClick={() => review("DRAFT")} className="px-4 py-2 text-sm">
            Back to drafts
          </Button>
        )}
        {editing ? (
          <>
            <Button variant="mango" disabled={pending} onClick={save} className="px-4 py-2 text-sm">
              Save changes
            </Button>
            <Button variant="ghost" disabled={pending} onClick={() => setEditing(false)} className="px-4 py-2 text-sm">
              Cancel
            </Button>
          </>
        ) : (
          <Button variant="ghost" disabled={pending} onClick={() => setEditing(true)} className="px-4 py-2 text-sm">
            Edit
          </Button>
        )}
      </div>
      <Message result={result} />
    </div>
  );
}

export function GenerateButton({
  skillId,
  lessonOrder,
  generatorName,
}: {
  skillId: string;
  lessonOrder: number;
  generatorName: string;
}) {
  const [pending, start] = useTransition();
  const [result, setResult] = useState<StudioResult | null>(null);
  return (
    <div className="flex flex-wrap items-center gap-3">
      <Button
        variant="secondary"
        disabled={pending}
        onClick={() => start(async () => setResult(await generateDraftsAction(skillId, lessonOrder)))}
        className="px-4 py-2 text-sm"
      >
        {pending ? "Generating…" : `Generate drafts with ${generatorName}`}
      </Button>
      <Message result={result} />
    </div>
  );
}
