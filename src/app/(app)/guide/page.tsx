/**
 * "Sounds of Tagalog": a short pronunciation guide with audio examples. Original content.
 */
import type { Metadata } from "next";
import Link from "next/link";
import { SpeakButton } from "@/components/speak-button";
import { Card } from "@/components/ui";
import { requireUser } from "@/server/session";

export const metadata: Metadata = { title: "Sounds of Tagalog" };

type Example = { tl: string; en: string };
type Section = { title: string; body: string; examples: Example[] };

const SECTIONS: Section[] = [
  {
    title: "Five clear vowels",
    body: "Tagalog vowels are short and pure, like in Spanish: a as in “father”, e as in “bed”, i as in “machine”, o as in “more”, u as in “flute”. They don't glide into other sounds the way English vowels often do.",
    examples: [
      { tl: "isa", en: "one" },
      { tl: "lima", en: "five" },
      { tl: "puti", en: "white" },
    ],
  },
  {
    title: "Spell it as you say it",
    body: "Modern Tagalog spelling is close to phonetic: almost every letter is pronounced, and the same way every time. If you can read a word, you can say it.",
    examples: [
      { tl: "salamat", en: "thank you" },
      { tl: "kaibigan", en: "friend" },
    ],
  },
  {
    title: "The ng sound",
    body: "Ng is one sound, like the end of “singer”, and Tagalog lets it start a word. The small word mga (plural marker) is said “ma-NGA”.",
    examples: [
      { tl: "ngayon", en: "now" },
      { tl: "mga bata", en: "children" },
      { tl: "Magandang umaga", en: "Good morning" },
    ],
  },
  {
    title: "The little catch in the throat",
    body: "Many words have a glottal stop, the catch in the middle of “uh-oh”. A hyphen often marks one inside a word, and many words that end in a vowel stop sharply.",
    examples: [
      { tl: "mag-aral", en: "to study" },
      { tl: "oo", en: "yes" },
    ],
  },
  {
    title: "Stress can change the meaning",
    body: "The same spelling can mean different things depending on which syllable is stressed. Bukas means “tomorrow” with stress on the first syllable (BU-kas) and “open” with stress on the last (bu-KAS). Listen closely and learn words with their stress.",
    examples: [
      { tl: "bukas", en: "tomorrow / open" },
      { tl: "araw", en: "day / sun" },
    ],
  },
  {
    title: "Po and opo",
    body: "These little words don't change the meaning of a sentence; they make it respectful. Use them with older people and strangers.",
    examples: [
      { tl: "Salamat po.", en: "Thank you (respectfully)." },
      { tl: "Opo.", en: "Yes (respectfully)." },
    ],
  },
];

export default async function GuidePage() {
  await requireUser();
  return (
    <div className="space-y-6">
      <Link href="/learn" className="font-bold text-lagoon hover:underline">
        Back to the path
      </Link>
      <header>
        <h1 className="font-display text-4xl">Sounds of Tagalog</h1>
        <p className="mt-1 text-ink-soft">
          A two-minute guide to how Tagalog sounds. Tap the speaker buttons to listen.
        </p>
      </header>
      {SECTIONS.map((s) => (
        <Card key={s.title}>
          <h2 className="font-display text-2xl">{s.title}</h2>
          <p className="mt-2 leading-relaxed">{s.body}</p>
          <ul className="mt-4 flex flex-wrap gap-3">
            {s.examples.map((ex) => (
              <li key={ex.tl} className="flex items-center gap-2 rounded-2xl bg-seaglass px-3 py-2">
                <SpeakButton text={ex.tl} size="sm" />
                <strong lang="tl">{ex.tl}</strong>
                <span className="text-ink-soft">{ex.en}</span>
              </li>
            ))}
          </ul>
        </Card>
      ))}
    </div>
  );
}
