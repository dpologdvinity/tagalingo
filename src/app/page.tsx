/** Public landing page. Signed-in learners go straight to their path. */
import Link from "next/link";
import { redirect } from "next/navigation";
import { DemoButton } from "./(auth)/auth-forms";
import { BoltIcon, CheckIcon, HeartIcon, SunIcon, TrophyIcon } from "@/components/icons";
import { Logo, Tala } from "@/components/tala";
import { ButtonLink } from "@/components/ui";
import { getCurrentUser } from "@/server/session";

/** A static, real exercise: what a lesson actually looks like. */
function ExercisePreview() {
  const tiles = ["kumusta", "ka", "salamat", "po"];
  return (
    <div className="relative mx-auto mt-10 w-full max-w-md md:mt-0">
      <div className="rounded-[2rem] border-2 border-line bg-surface p-6 shadow-press">
        <div className="mb-5 flex items-center gap-3" aria-hidden>
          <span className="h-3 flex-1 rounded-full bg-line">
            <span className="block h-full w-3/5 rounded-full bg-lagoon-bright" />
          </span>
          <span className="inline-flex items-center gap-1 font-bold text-gumamela">
            <HeartIcon size={18} />5
          </span>
        </div>
        <p className="font-display text-2xl">Translate into Tagalog</p>
        <p className="mt-3 inline-block rounded-2xl border-2 border-line px-4 py-2.5 text-lg font-bold">How are you?</p>
        <div className="mt-4 flex min-h-14 flex-wrap gap-2 border-y-2 border-line py-3">
          {tiles.slice(0, 2).map((t) => (
            <span key={t} lang="tl" className="rounded-xl border-2 border-line px-3 py-1.5 font-bold shadow-press">
              {t}
            </span>
          ))}
        </div>
        <div className="mt-4 flex flex-wrap justify-center gap-2">
          {tiles.map((t, i) =>
            i < 2 ? (
              <span key={t} className="rounded-xl bg-line px-3 py-1.5 font-bold text-transparent">
                {t}
              </span>
            ) : (
              <span key={t} lang="tl" className="rounded-xl border-2 border-line px-3 py-1.5 font-bold shadow-press">
                {t}
              </span>
            ),
          )}
        </div>
        <div className="-mx-6 -mb-6 mt-6 flex items-center gap-3 rounded-b-[2rem] bg-lagoon-soft px-6 py-4">
          <span className="rounded-full bg-lagoon-bright p-1 text-white">
            <CheckIcon size={18} />
          </span>
          <span className="font-display text-xl text-lagoon">Magaling!</span>
          <span className="ml-auto text-sm font-bold text-lagoon">+10 XP</span>
        </div>
      </div>
      <Tala size={84} className="absolute -top-14 left-8 -rotate-6" />
    </div>
  );
}

const FEATURES = [
  {
    icon: BoltIcon,
    color: "text-mango",
    title: "Lessons that fit in a coffee break",
    body: "Ten quick exercises: pick the meaning, build sentences from tiles, match pairs, type answers.",
  },
  {
    icon: SunIcon,
    color: "text-mango",
    title: "A streak worth protecting",
    body: "Set a daily XP goal. Finish one lesson a day and your streak grows.",
  },
  {
    icon: HeartIcon,
    color: "text-gumamela",
    title: "Five hearts, no paywall",
    body: "Mistakes cost a heart. Hearts come back on their own, one every half hour.",
  },
  {
    icon: TrophyIcon,
    color: "text-lagoon",
    title: "The weekly Barkada League",
    body: "Everyone starts at zero on Monday. Earn XP to climb the board before it resets.",
  },
];

export default async function Home() {
  if (await getCurrentUser()) redirect("/learn");
  return (
    <div className="min-h-screen">
      <header className="mx-auto flex max-w-6xl items-center justify-between px-5 py-5">
        <Logo />
        <Link href="/login" className="font-bold text-lagoon hover:underline">
          Log in
        </Link>
      </header>

      <main>
        <section className="mx-auto grid max-w-6xl items-center gap-14 px-5 pb-20 pt-8 md:grid-cols-2 md:pt-16">
          <div>
            <h1 className="font-display text-5xl leading-[1.05] text-ink sm:text-6xl">
              Learn Tagalog five minutes at a time.
            </h1>
            <p className="mt-5 max-w-md text-xl text-ink-soft">
              Say hello to your lola, order at the palengke, count your change. Short lessons, real sentences, and a
              tarsier named Tala cheering you on.
            </p>
            <div className="mt-8 flex max-w-sm flex-col gap-3">
              <ButtonLink href="/signup" className="text-lg">
                Start learning, it’s free
              </ButtonLink>
              <DemoButton />
            </div>
          </div>
          <ExercisePreview />
        </section>

        <section aria-label="How Tagalingo works" className="border-t-2 border-line bg-surface">
          <ul className="mx-auto grid max-w-6xl gap-x-12 gap-y-10 px-5 py-16 sm:grid-cols-2">
            {FEATURES.map(({ icon: Icon, color, title, body }) => (
              <li key={title} className="flex gap-4">
                <Icon size={36} className={`shrink-0 ${color}`} />
                <div>
                  <h2 className="font-display text-2xl">{title}</h2>
                  <p className="mt-1 max-w-sm text-lg text-ink-soft">{body}</p>
                </div>
              </li>
            ))}
          </ul>
        </section>
      </main>

      <footer className="mx-auto max-w-6xl px-5 py-8 text-ink-soft">
        <p>Tagalingo is an independent project for learning Tagalog (Filipino).</p>
      </footer>
    </div>
  );
}
