/**
 * Studio: every grammar card as learners read it, with a way to flag a problem and the open flags
 * across the course gathered at the top.
 */
import type { Metadata } from "next";
import Link from "next/link";
import { GrammarCardView } from "@/components/player/grammar-card";
import { getGrammarForReview, type ReviewFlag } from "@/server/studio";
import { requireReviewer } from "@/server/session";
import { FlagForm, ResolveButton } from "./flag-form";

export const metadata: Metadata = { title: "Grammar cards" };

const date = (d: Date) => d.toLocaleDateString("en", { day: "numeric", month: "short", year: "numeric" });

function FlagItem({ flag, title }: { flag: ReviewFlag; title?: string }) {
  return (
    <li className="space-y-1 py-3">
      {title && <p className="font-bold">{title}</p>}
      <p>{flag.note}</p>
      <p className="text-sm text-ink-soft">
        Flagged by {flag.by} on {date(flag.createdAt)}
        {flag.resolvedAt && `, resolved ${date(flag.resolvedAt)}`}
      </p>
      {!flag.resolvedAt && <ResolveButton flagId={flag.id} />}
    </li>
  );
}

export default async function GrammarReviewPage() {
  await requireReviewer();
  const patterns = await getGrammarForReview();
  const open = patterns.flatMap((p) => p.flags.filter((f) => !f.resolvedAt).map((flag) => ({ flag, title: p.title })));

  return (
    <div className="space-y-8">
      <Link href="/studio" className="font-bold text-lagoon hover:underline">
        Back to studio
      </Link>
      <header>
        <h1 className="font-display text-4xl">Grammar cards</h1>
        <p className="mt-1 text-ink-soft">
          Each card is shown the way learners read it. Flag anything wrong or unclear; edit the card in{" "}
          <code>content/tagalog/course.yaml</code>.
        </p>
      </header>

      <section aria-labelledby="open-flags" className="rounded-3xl border-2 border-line bg-surface p-5">
        <h2 id="open-flags" className="font-display text-2xl">
          Open flags ({open.length})
        </h2>
        {open.length === 0 ? (
          <p className="mt-2 text-ink-soft">Nothing is flagged.</p>
        ) : (
          <ul className="mt-2 divide-y divide-line [&>li:last-child]:pb-0">
            {open.map(({ flag, title }) => (
              <FlagItem key={flag.id} flag={flag} title={title} />
            ))}
          </ul>
        )}
      </section>

      {patterns.length === 0 && (
        <p className="rounded-3xl border-2 border-dashed border-line p-5 text-ink-soft">
          No grammar patterns yet. Add them under <code>grammar</code> in course.yaml and run the seed.
        </p>
      )}

      <section aria-labelledby="cards" className="space-y-4">
        <h2 id="cards" className="font-display text-2xl">
          Cards ({patterns.length})
        </h2>
        {patterns.map((p) => {
          const flags = p.flags.filter((f) => !f.resolvedAt);
          const resolved = p.flags.filter((f) => f.resolvedAt);
          return (
            <section
              key={p.slug}
              aria-label={p.title}
              className="space-y-4 rounded-3xl border-2 border-line bg-surface p-5"
            >
              <p className="text-sm text-ink-soft">
                {p.skillTitle} · {p.taggedExercises} drill{p.taggedExercises === 1 ? "" : "s"} tagged
              </p>
              {p.card ? (
                <GrammarCardView card={{ slug: p.slug, title: p.title, card: p.card, isNew: false }} headingLevel={3} />
              ) : (
                <>
                  <h3 className="font-display text-3xl">{p.title}</h3>
                  <p role="alert" className="rounded-2xl bg-mango-soft px-4 py-3 text-sm">
                    ⚠️ The stored card is not valid: {p.cardError}
                  </p>
                </>
              )}
              <FlagForm patternSlug={p.slug} patternTitle={p.title} />
              {flags.length > 0 && (
                <ul className="divide-y divide-line rounded-2xl bg-mango-soft px-4">
                  {flags.map((f) => (
                    <FlagItem key={f.id} flag={f} />
                  ))}
                </ul>
              )}
              {resolved.length > 0 && (
                <details>
                  <summary className="cursor-pointer font-bold">Resolved ({resolved.length})</summary>
                  <ul className="divide-y divide-line">
                    {resolved.map((f) => (
                      <FlagItem key={f.id} flag={f} />
                    ))}
                  </ul>
                </details>
              )}
            </section>
          );
        })}
      </section>
    </div>
  );
}
