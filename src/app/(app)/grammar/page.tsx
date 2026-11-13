/**
 * Grammar: every pattern in course order. Unlocked patterns show their card, how well the learner
 * knows them and a button to practise just that pattern; locked ones show only their title and the
 * skill that unlocks them.
 */
import type { Metadata } from "next";
import { LockIcon } from "@/components/icons";
import { PatternEntry } from "@/components/pattern-entry";
import { Button, ButtonLink, Card } from "@/components/ui";
import { getGrammarOverview, weakestPatterns } from "@/server/grammar";
import { requireUser } from "@/server/session";

export const metadata: Metadata = { title: "Grammar" };

export default async function GrammarPage() {
  const user = await requireUser();
  const now = new Date();
  const [patterns, weakest] = await Promise.all([getGrammarOverview(user.id, now), weakestPatterns(user.id, now)]);

  return (
    <div className="space-y-6">
      <h1 className="font-display text-4xl">Grammar</h1>

      {patterns.length === 0 ? (
        <p className="rounded-3xl border-2 border-dashed border-line p-5 text-ink-soft">
          Grammar notes appear here as you unlock lessons.
        </p>
      ) : (
        <>
          <div className="space-y-2">
            {weakest.length > 0 ? (
              <ButtonLink href="/practice?weak=grammar">Practise your weakest grammar</ButtonLink>
            ) : (
              <>
                <Button disabled aria-describedby="weak-help">
                  Practise your weakest grammar
                </Button>
                <p id="weak-help" className="text-ink-soft">
                  Answer a few grammar drills first.
                </p>
              </>
            )}
          </div>

          <ul className="space-y-6">
            {patterns.map((p) => (
              <li key={p.slug}>
                {p.card ? (
                  <Card>
                    <PatternEntry slug={p.slug} title={p.title} card={p.card} label={p.label} effective={p.effective} />
                  </Card>
                ) : (
                  <div className="flex items-center gap-3 rounded-3xl border-2 border-dashed border-line px-5 py-4 text-ink-soft">
                    <LockIcon size={20} />
                    <div>
                      <h2 className="font-bold">{p.title}</h2>
                      <p>Unlocks in {p.skillTitle}</p>
                    </div>
                  </div>
                )}
              </li>
            ))}
          </ul>
        </>
      )}
    </div>
  );
}
