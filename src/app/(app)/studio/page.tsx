import type { Metadata } from "next";
import Link from "next/link";
import { selectGenerator } from "@/lib/content/generators";
import { getStudioOverview } from "@/server/studio";
import { requireReviewer } from "@/server/session";

export const metadata: Metadata = { title: "Studio" };

export default async function StudioPage() {
  await requireReviewer();
  const rows = await getStudioOverview();
  let generator = "offline stub";
  try {
    const g = selectGenerator();
    generator = g.provider === "claude" ? `Claude (${g.model})` : "the offline stub (no ANTHROPIC_API_KEY set)";
  } catch (e) {
    generator = `misconfigured: ${e instanceof Error ? e.message : String(e)}`;
  }
  const pending = rows.reduce((n, r) => n + r.counts.DRAFT, 0);

  return (
    <div className="space-y-6">
      <header>
        <h1 className="font-display text-4xl">Content studio</h1>
        <p className="mt-1 text-ink-soft">
          Exercises are generated from each skill’s word list, then reviewed here by hand. Learners only ever see
          approved exercises.
        </p>
      </header>

      <div className="rounded-3xl border-2 border-line bg-surface p-5">
        <p>
          <strong>{pending}</strong> draft{pending === 1 ? "" : "s"} waiting for review. New drafts are written by{" "}
          <strong>{generator}</strong>.
        </p>
        <p className="mt-2 text-sm text-ink-soft">
          To keep approved content in the repository, run{" "}
          <code className="rounded bg-seaglass px-1.5 py-0.5">npm run content:export</code>.
        </p>
      </div>

      <div className="overflow-hidden rounded-3xl border-2 border-line bg-surface">
        <table className="w-full text-left">
          <thead className="border-b-2 border-line bg-seaglass text-sm text-ink-soft">
            <tr>
              <th className="px-4 py-3 font-bold">Skill</th>
              <th className="px-2 py-3 text-right font-bold">Drafts</th>
              <th className="px-2 py-3 text-right font-bold">Approved</th>
              <th className="hidden px-4 py-3 text-right font-bold sm:table-cell">Rejected</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id} className="border-b border-line last:border-0">
                <td className="px-4 py-3">
                  <Link href={`/studio/skills/${r.id}`} className="font-bold text-lagoon hover:underline">
                    <span aria-hidden>{r.emoji} </span>
                    {r.title}
                  </Link>
                  <span className="block text-sm text-ink-soft">{r.unitTitle}</span>
                </td>
                <td className="px-2 py-3 text-right">
                  {r.counts.DRAFT > 0 ? (
                    <span className="rounded-full bg-mango-soft px-2.5 py-0.5 font-bold text-mango-deep">
                      {r.counts.DRAFT}
                    </span>
                  ) : (
                    <span className="text-ink-soft">0</span>
                  )}
                </td>
                <td className="px-2 py-3 text-right font-bold">{r.counts.APPROVED}</td>
                <td className="hidden px-4 py-3 text-right text-ink-soft sm:table-cell">{r.counts.REJECTED}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
