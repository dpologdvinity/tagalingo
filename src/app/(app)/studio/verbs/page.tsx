/** Studio: review the verb tables the grammar engine drafts, one card per root and affix. */
import type { Metadata } from "next";
import Link from "next/link";
import { getVerbTablesForReview } from "@/server/studio";
import { requireReviewer } from "@/server/session";
import { FILTERS, FILTER_LABEL, parseFilter, type Filter } from "../status-style";
import { VerbCard } from "./verb-grid";

export const metadata: Metadata = { title: "Verb tables" };

export default async function VerbTablesPage({ searchParams }: PageProps<"/studio/verbs">) {
  await requireReviewer();
  const sp = await searchParams;
  const all = await getVerbTablesForReview();
  const filter: Filter = parseFilter(sp.status) ?? (all.some((t) => t.status === "DRAFT") ? "DRAFT" : "ALL");
  const count = (f: Filter) => (f === "ALL" ? all.length : all.filter((t) => t.status === f).length);
  const shown = all.filter((t) => filter === "ALL" || t.status === filter);

  return (
    <div className="space-y-6">
      <Link href="/studio" className="font-bold text-lagoon hover:underline">
        Back to studio
      </Link>
      <header>
        <h1 className="font-display text-4xl">Verb tables</h1>
        <p className="mt-1 text-ink-soft">
          The engine drafts each form from its rules. Fix any cell that is wrong (a comma separates accepted variants;
          the first is the one learners see), then approve. Learners only ever see approved tables.
        </p>
      </header>

      <nav aria-label="Filter verb tables" className="flex flex-wrap gap-2">
        {FILTERS.map((f) => (
          <Link
            key={f}
            href={`/studio/verbs?status=${f.toLowerCase()}`}
            aria-current={f === filter ? "page" : undefined}
            className={`rounded-full border-2 px-4 py-1.5 font-bold ${f === filter ? "border-lagoon-bright bg-lagoon-soft text-lagoon" : "border-line bg-surface text-ink-soft"}`}
          >
            {FILTER_LABEL[f]} ({count(f)})
          </Link>
        ))}
      </nav>

      {all.length === 0 ? (
        <p className="rounded-3xl border-2 border-dashed border-line p-5 text-ink-soft">
          No verb tables yet. Run <code>npm run grammar:draft</code> after adding verbs to course.yaml.
        </p>
      ) : shown.length === 0 ? (
        <p className="rounded-3xl border-2 border-dashed border-line p-5 text-ink-soft">
          No {filter === "ALL" ? "" : `${FILTER_LABEL[filter].toLowerCase()} `}verb tables.
        </p>
      ) : (
        <ul className="space-y-4">
          {shown.map((t) => (
            <li key={t.id}>
              <VerbCard table={t} />
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
