import type { Metadata } from "next";
import { getPathForUser } from "@/server/course";
import { requireUser } from "@/server/session";
import { SkillPath } from "./skill-path";

export const metadata: Metadata = { title: "Learn" };

export default async function LearnPage() {
  const user = await requireUser();
  const path = await getPathForUser(user.id);
  if (!path) {
    return (
      <div className="rounded-3xl border-2 border-dashed border-line p-8 text-center">
        <h1 className="font-display text-2xl">No course loaded yet</h1>
        <p className="mt-2 text-ink-soft">
          Run <code className="rounded bg-surface px-1.5 py-0.5">npm run db:seed</code> to load the Tagalog course.
        </p>
      </div>
    );
  }
  return (
    <>
      <h1 className="sr-only">{path.courseTitle}</h1>
      <SkillPath path={path} />
    </>
  );
}
