/** Skill page: grammar tips, flashcards, dialogues to read, and start/practise buttons. */
import type { Metadata, Route } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { SpeakButton } from "@/components/speak-button";
import { ButtonLink, Card } from "@/components/ui";
import { getSkillPage } from "@/server/course";
import { requireUser } from "@/server/session";
import { Flashcards } from "./flashcards";

export const metadata: Metadata = { title: "Skill" };

export default async function SkillPage({ params }: PageProps<"/skills/[slug]">) {
  const { slug } = await params;
  const user = await requireUser();
  const skill = await getSkillPage(user.id, slug);
  if (!skill) notFound();
  const playable = skill.state === "active" || skill.state === "complete";

  return (
    <div className="space-y-6">
      <Link href="/learn" className="font-bold text-lagoon hover:underline">
        Back to the path
      </Link>
      <header className="flex items-center gap-4">
        <span aria-hidden className="text-5xl">
          {skill.emoji}
        </span>
        <div>
          <h1 className="font-display text-4xl">{skill.title}</h1>
          <p className="text-ink-soft">
            {skill.description}. {skill.unitTitle}, {skill.completedLessons} of {skill.totalLessons} lessons done.
          </p>
        </div>
      </header>

      <div className="flex flex-wrap gap-3">
        {playable && skill.nextLessonId && (
          <ButtonLink href={`/lesson/${skill.nextLessonId}` as Route}>
            {skill.state === "complete" ? "Replay a lesson" : skill.completedLessons > 0 ? "Continue" : "Start lesson"}
          </ButtonLink>
        )}
        {skill.completedLessons > 0 && (
          <ButtonLink href={`/practice?skill=${skill.id}` as Route} variant="secondary">
            Practise this skill
          </ButtonLink>
        )}
      </div>

      {skill.tips.length > 0 && (
        <Card>
          <h2 className="mb-3 font-display text-2xl">Tips</h2>
          <ul className="space-y-3">
            {skill.tips.map((tip) => (
              <li key={tip} className="flex gap-3">
                <span aria-hidden className="mt-1 h-2.5 w-2.5 shrink-0 rounded-full bg-mango" />
                <p className="leading-relaxed">{tip}</p>
              </li>
            ))}
          </ul>
        </Card>
      )}

      <Card>
        <h2 className="mb-3 font-display text-2xl">Words ({skill.words.length})</h2>
        <Flashcards words={skill.words} />
        <details className="mt-4">
          <summary className="cursor-pointer font-bold text-lagoon">Show all words</summary>
          <ul className="mt-3 divide-y divide-line">
            {skill.words.map((w) => (
              <li key={w.tl} className="flex items-center gap-3 py-2">
                <SpeakButton text={w.tl} size="sm" />
                <span aria-hidden className="w-7 text-xl">
                  {w.pic}
                </span>
                <strong lang="tl">{w.tl}</strong>
                <span className="text-ink-soft">{w.en}</span>
              </li>
            ))}
          </ul>
        </details>
      </Card>

      {skill.dialogues.length > 0 && (
        <Card>
          <h2 className="mb-3 font-display text-2xl">Conversations</h2>
          <div className="space-y-5">
            {skill.dialogues.map((d, di) => (
              <ol key={di} className="space-y-2" aria-label={`Conversation ${di + 1}`}>
                {d.lines.map(([speaker, tl, en], li) => (
                  <li key={li} className={`flex items-end gap-2 ${speaker === "B" ? "flex-row-reverse" : ""}`}>
                    <span
                      aria-hidden
                      className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-sm font-bold text-white ${
                        speaker === "A" ? "bg-mango-deep" : "bg-lagoon"
                      }`}
                    >
                      {speaker}
                    </span>
                    <div
                      className={`max-w-[85%] rounded-3xl border-2 px-4 py-2 ${
                        speaker === "A"
                          ? "rounded-bl-md border-mango/50 bg-mango-soft"
                          : "rounded-br-md border-line bg-surface"
                      }`}
                    >
                      <p lang="tl" className="flex items-center gap-2 font-bold">
                        {tl} <SpeakButton text={tl} size="sm" />
                      </p>
                      <p className="text-sm text-ink-soft">{en}</p>
                    </div>
                  </li>
                ))}
              </ol>
            ))}
          </div>
        </Card>
      )}
    </div>
  );
}
