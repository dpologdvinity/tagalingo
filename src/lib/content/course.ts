/**
 * Loads and validates the hand-written course definition (content/<lang>/course.yaml).
 *
 * The YAML defines structure (units → skills → lessons) and the word list each skill teaches.
 * It deliberately contains no exercises: those are generated from the words, reviewed by a
 * human in /studio, and exported to content/<lang>/exercises/*.json.
 *
 * It also holds the grammar: top-level `grammar` patterns (cards plus drill ingredients), per-skill
 * `verbs` for the morphology engine, and per-lesson `teaches`/`uses` pattern ids.
 */
import fs from "node:fs";
import YAML from "yaml";
import { z } from "zod";
import type { VerbTableData } from "../grammar/analyse";
import type { VerbEntry } from "../grammar/types";
import { patternSchema, verbEntrySchema, type CoursePattern } from "./grammar-schema";

const text = z.string().trim().min(1);

const wordSchema = z.object({
  tl: text,
  en: text,
  accept: z.array(text).default([]),
  pos: z.enum(["noun", "verb", "adjective", "pronoun", "phrase", "particle", "number", "adverb"]),
  note: text.optional(),
  ex: z.tuple([text, text]),
  exAccept: z.array(text).default([]),
  /** Optional emoji shown beside the word on flashcards and word lists (never quizzed on its own). */
  pic: text.optional(),
});

/** A short conversation; the last line is B's reply, which learners have to pick. */
const dialogueSchema = z
  .object({
    /** 1-based lesson this dialogue belongs to. */
    lesson: z.number().int().positive(),
    lines: z
      .array(z.tuple([z.enum(["A", "B"]), text, text]))
      .min(2)
      .max(6),
    /** Two or three clearly wrong replies to offer alongside the right one. */
    wrong: z.array(text).min(2).max(3),
  })
  .refine((d) => d.lines[d.lines.length - 1][0] === "B", {
    message: "a dialogue must end with B's reply (the line learners choose)",
    path: ["lines"],
  })
  .refine((d) => !d.wrong.some((w) => w.trim().toLowerCase() === d.lines[d.lines.length - 1][1].trim().toLowerCase()), {
    message: "a dialogue's wrong replies must not include the right reply",
    path: ["wrong"],
  });

const skillSchema = z
  .object({
    slug: z.string().regex(/^[a-z0-9-]+$/),
    title: text,
    emoji: text,
    description: text,
    lessons: z
      .array(
        z.object({
          title: text,
          words: z.array(text).min(1),
          /** Ids of grammar patterns this lesson introduces (each pattern is taught exactly once). */
          teaches: z.array(text).default([]),
          /** Ids of earlier patterns this lesson practises again. */
          uses: z.array(text).default([]),
        }),
      )
      .min(1),
    words: z.array(wordSchema).min(4),
    /** Short grammar and culture notes shown on the skill's tips page. */
    tips: z.array(text).default([]),
    dialogues: z.array(dialogueSchema).default([]),
    /** Verbs the morphology engine conjugates for this skill's lessons (and every later skill's). */
    verbs: z.array(verbEntrySchema).default([]),
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
    skill.dialogues.forEach((d, di) => {
      if (d.lesson > skill.lessons.length)
        ctx.addIssue({
          code: "custom",
          path: ["dialogues", di, "lesson"],
          message: `Dialogue ${di + 1} points at lesson ${d.lesson}, but ${skill.slug} has ${skill.lessons.length} lessons`,
        });
    });
    const pics = new Map<string, string>();
    skill.words.forEach((w, wi) => {
      if (w.pic && pics.has(w.pic))
        ctx.addIssue({
          code: "custom",
          path: ["words", wi, "pic"],
          message: `"${w.tl}" and "${pics.get(w.pic)}" use the same picture ${w.pic}`,
        });
      if (w.pic) pics.set(w.pic, w.tl);
    });
    skill.words.forEach((w, wi) => {
      if (!w.ex[0].toLocaleLowerCase().includes(w.tl.toLocaleLowerCase()))
        ctx.addIssue({
          code: "custom",
          path: ["words", wi, "ex"],
          message: `Example sentence for "${w.tl}" must contain the word itself`,
        });
    });
  });

const courseSchema = z
  .object({
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
    /** Grammar patterns in course order. */
    grammar: z.array(patternSchema).default([]),
  })
  .superRefine((course, ctx) => {
    const fail = (path: (string | number)[], message: string) => ctx.addIssue({ code: "custom", path, message });
    const ids = new Set<string>();
    course.grammar.forEach((p, pi) => {
      if (ids.has(p.id)) fail(["grammar", pi, "id"], `duplicate pattern id "${p.id}"`);
      ids.add(p.id);
    });

    // Walk lessons in course order; a pattern's "teach position" is the course-wide index of its lesson.
    const taughtAt = new Map<string, number>();
    let position = 0;
    course.units.forEach((unit, ui) =>
      unit.skills.forEach((skill, si) =>
        skill.lessons.forEach((lesson, li) => {
          const path = ["units", ui, "skills", si, "lessons", li];
          lesson.teaches.forEach((id) => {
            if (!ids.has(id)) fail([...path, "teaches"], `Lesson "${lesson.title}" teaches unknown pattern "${id}"`);
            else if (taughtAt.has(id)) fail([...path, "teaches"], `Pattern "${id}" is taught by more than one lesson`);
            else taughtAt.set(id, position);
          });
          position++;
        }),
      ),
    );

    course.grammar.forEach((p, pi) => {
      if (!taughtAt.has(p.id)) fail(["grammar", pi], `Pattern "${p.id}" is not taught by any lesson`);
      p.requires.forEach((id) => {
        if (!ids.has(id)) fail(["grammar", pi, "requires"], `Pattern "${p.id}" requires unknown pattern "${id}"`);
        else if ((taughtAt.get(id) ?? -1) > (taughtAt.get(p.id) ?? Infinity))
          fail(["grammar", pi, "requires"], `Pattern "${p.id}" requires "${id}", which is taught later`);
      });
    });

    // `uses` is checked after all teach positions are known, so a forward reference is caught.
    position = 0;
    course.units.forEach((unit, ui) =>
      unit.skills.forEach((skill, si) =>
        skill.lessons.forEach((lesson, li) => {
          const path = ["units", ui, "skills", si, "lessons", li, "uses"];
          lesson.uses.forEach((id) => {
            if (!ids.has(id)) fail(path, `Lesson "${lesson.title}" uses unknown pattern "${id}"`);
            else if ((taughtAt.get(id) ?? -1) > position)
              fail(path, `Lesson "${lesson.title}" uses "${id}", which is taught later`);
          });
          position++;
        }),
      ),
    );
  });

export type CourseWord = z.infer<typeof wordSchema>;
export type CourseSkill = z.infer<typeof skillSchema>;
export type CourseDialogue = z.infer<typeof dialogueSchema>;
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
  /** Hand-written dialogues for this lesson. */
  dialogues: CourseDialogue[];
  grammar: {
    /** Patterns this lesson introduces. */
    teaches: CoursePattern[];
    /** Earlier patterns this lesson practises again. */
    uses: CoursePattern[];
    /** Verbs of this skill and every earlier skill. */
    verbs: VerbEntry[];
    /** Lower-cased tokens of every lesson word taught up to and including this lesson (`knownWordsUpTo`). */
    knownWords: string[];
    /** Approved verb tables; `lessonRequest` leaves this empty and callers with a database fill it. */
    verbTables: VerbTableData[];
  };
};

/** Lower-cased word tokens of a (possibly multi-word) entry, trimmed of surrounding punctuation. */
function tokens(tl: string): string[] {
  return tl
    .toLocaleLowerCase("en")
    .split(/\s+/)
    .map((t) => t.replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, ""))
    .filter((t) => t !== "");
}

/**
 * The one definition of "known words": every word of every lesson of every earlier skill (course
 * order) plus this skill's lessons up to and including `lessonIndex`, as lower-cased tokens. A word
 * that sits in a skill's word list but in no lesson is not taught yet, so it is not known.
 */
export function knownWordsUpTo(course: CourseDefinition, skillSlug: string, lessonIndex: number): Set<string> {
  const skills = course.units.flatMap((u) => u.skills);
  const skillAt = skills.findIndex((s) => s.slug === skillSlug);
  if (skillAt < 0) throw new Error(`Skill ${skillSlug} is not in the course`);
  const lessons = [
    ...skills.slice(0, skillAt).flatMap((s) => s.lessons),
    ...skills[skillAt].lessons.slice(0, lessonIndex + 1),
  ];
  return new Set(lessons.flatMap((l) => l.words).flatMap(tokens));
}

export function lessonRequest(course: CourseDefinition, skill: CourseSkill, lessonIndex: number): GenerationRequest {
  const byTl = new Map(skill.words.map((w) => [w.tl, w]));
  const pick = (tls: string[]) => tls.map((t) => byTl.get(t)).filter((w): w is CourseWord => !!w);
  const lesson = skill.lessons[lessonIndex];
  if (!lesson) throw new Error(`Skill ${skill.slug} has no lesson #${lessonIndex}`);
  const earlier = skill.lessons.slice(0, lessonIndex).flatMap((l) => l.words);

  const skills = course.units.flatMap((u) => u.skills);
  const skillAt = skills.findIndex((s) => s.slug === skill.slug);
  if (skillAt < 0) throw new Error(`Skill ${skill.slug} is not in the course`);
  const earlierSkills = skills.slice(0, skillAt);
  const patterns = (ids: string[]) =>
    ids.map((id) => {
      const found = course.grammar.find((p) => p.id === id);
      if (!found) throw new Error(`Lesson "${lesson.title}" refers to unknown pattern "${id}"`);
      return found;
    });
  return {
    skill: { slug: skill.slug, title: skill.title, description: skill.description },
    lesson: { title: lesson.title, index: lessonIndex },
    words: pick(lesson.words),
    reviewWords: pick(earlier.filter((w) => !lesson.words.includes(w))),
    allWords: skill.words,
    dialogues: skill.dialogues.filter((d) => d.lesson === lessonIndex + 1),
    grammar: {
      teaches: patterns(lesson.teaches),
      uses: patterns(lesson.uses),
      verbs: [...earlierSkills, skill].flatMap((s) => s.verbs),
      knownWords: [...knownWordsUpTo(course, skill.slug, lessonIndex)],
      verbTables: [],
    },
  };
}
