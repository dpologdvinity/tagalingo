/**
 * Loads and validates the hand-written course definition (content/<lang>/course.yaml).
 *
 * The YAML defines structure (units → skills → lessons) and the word list each skill teaches.
 * It deliberately contains no exercises: those are generated from the words, reviewed by a
 * human in /studio, and exported to content/<lang>/exercises/*.json.
 */
import fs from "node:fs";
import YAML from "yaml";
import { z } from "zod";

const text = z.string().trim().min(1);

const wordSchema = z.object({
  tl: text,
  en: text,
  accept: z.array(text).default([]),
  pos: z.enum(["noun", "verb", "adjective", "pronoun", "phrase", "particle", "number", "adverb"]),
  note: text.optional(),
  ex: z.tuple([text, text]),
  exAccept: z.array(text).default([]),
});

const skillSchema = z
  .object({
    slug: z.string().regex(/^[a-z0-9-]+$/),
    title: text,
    emoji: text,
    description: text,
    lessons: z.array(z.object({ title: text, words: z.array(text).min(1) })).min(1),
    words: z.array(wordSchema).min(4),
  })
  .superRefine((skill, ctx) => {
    const known = new Set(skill.words.map((w) => w.tl));
    skill.lessons.forEach((lesson, li) =>
      lesson.words.forEach((w) => {
        if (!known.has(w))
          ctx.addIssue({
            code: "custom",
            path: ["lessons", li, "words"],
            message: `Lesson "${lesson.title}" uses "${w}", which is not in the ${skill.slug} word list`,
          });
      }),
    );
    skill.words.forEach((w, wi) => {
      if (!w.ex[0].toLocaleLowerCase().includes(w.tl.toLocaleLowerCase()))
        ctx.addIssue({
          code: "custom",
          path: ["words", wi, "ex"],
          message: `Example sentence for "${w.tl}" must contain the word itself`,
        });
    });
  });

const courseSchema = z.object({
  course: z.object({ slug: text, title: text, fromLang: text, toLang: text }),
  units: z
    .array(
      z.object({
        slug: z.string().regex(/^[a-z0-9-]+$/),
        title: text,
        subtitle: text,
        color: z.string().regex(/^#[0-9a-fA-F]{6}$/),
        skills: z.array(skillSchema).min(1),
      }),
    )
    .min(1),
});

export type CourseWord = z.infer<typeof wordSchema>;
export type CourseSkill = z.infer<typeof skillSchema>;
export type CourseDefinition = z.infer<typeof courseSchema>;

export function parseCourse(raw: unknown): CourseDefinition {
  const result = courseSchema.safeParse(raw);
  if (!result.success) {
    const summary = result.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("\n  ");
    throw new Error(`Invalid course definition:\n  ${summary}`);
  }
  return result.data;
}

export function loadCourseFile(file: string): CourseDefinition {
  return parseCourse(YAML.parse(fs.readFileSync(file, "utf8")));
}

/** Everything a generator needs to write one lesson. */
export type GenerationRequest = {
  skill: { slug: string; title: string; description: string };
  lesson: { title: string; index: number };
  /** Words this lesson introduces. */
  words: CourseWord[];
  /** Words from earlier lessons of the same skill, safe to reuse for review. */
  reviewWords: CourseWord[];
  /** The whole skill vocabulary, used as a distractor pool. */
  allWords: CourseWord[];
};

export function lessonRequest(skill: CourseSkill, lessonIndex: number): GenerationRequest {
  const byTl = new Map(skill.words.map((w) => [w.tl, w]));
  const pick = (tls: string[]) => tls.map((t) => byTl.get(t)).filter((w): w is CourseWord => !!w);
  const lesson = skill.lessons[lessonIndex];
  if (!lesson) throw new Error(`Skill ${skill.slug} has no lesson #${lessonIndex}`);
  const earlier = skill.lessons.slice(0, lessonIndex).flatMap((l) => l.words);
  return {
    skill: { slug: skill.slug, title: skill.title, description: skill.description },
    lesson: { title: lesson.title, index: lessonIndex },
    words: pick(lesson.words),
    reviewWords: pick(earlier.filter((w) => !lesson.words.includes(w))),
    allWords: skill.words,
  };
}
