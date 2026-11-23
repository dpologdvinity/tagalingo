import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { loadCourseFile, parseCourse } from "./course";
import { checkShippedContent, formatContentReport, loadShippedContent } from "./shipped";

const course = parseCourse({
  course: { slug: "tl-en", title: "T", fromLang: "en", toLang: "tl" },
  units: [
    {
      slug: "u1",
      title: "U1",
      subtitle: "s",
      color: "#0F8287",
      skills: [
        {
          slug: "pagbati",
          title: "Greetings",
          emoji: "👋",
          description: "d",
          lessons: [
            { title: "L1", words: ["salamat"] },
            { title: "L2", words: ["oo"] },
          ],
          words: [
            { tl: "salamat", en: "thank you", pos: "phrase", ex: ["Salamat po.", "Thank you."] },
            { tl: "oo", en: "yes", pos: "particle", ex: ["Oo, salamat.", "Yes, thanks."] },
            { tl: "hindi", en: "no", pos: "particle", ex: ["Hindi po.", "No, sir."] },
            { tl: "paalam", en: "goodbye", pos: "phrase", ex: ["Paalam, Ana.", "Goodbye, Ana."] },
          ],
        },
      ],
    },
  ],
});

const select = {
  type: "select_translation",
  payload: { prompt: "salamat", promptLang: "tl", options: ["thank you", "yes", "no"], answerIndex: 0 },
  source: "HUMAN",
};
const typed = {
  type: "type_translation",
  payload: { prompt: "Thank you", promptLang: "en", answers: ["Salamat"] },
  source: "CLAUDE",
};

const file = (lessons: unknown[], skill = "pagbati") => ({ name: `${skill}.json`, raw: { skill, lessons } });

describe("checkShippedContent", () => {
  it("accepts valid files and counts exercises per skill and type", () => {
    const report = checkShippedContent(course, [
      file([
        { order: 1, title: "L1", exercises: [select, typed] },
        { order: 2, title: "L2", exercises: [select] },
      ]),
    ]);
    expect(report.errors).toEqual([]);
    expect(report.skills).toEqual([
      {
        slug: "pagbati",
        title: "Greetings",
        lessons: 2,
        lessonsWithExercises: 2,
        exercises: 3,
        byType: { select_translation: 2, type_translation: 1 },
      },
    ]);
    expect(report.totals).toMatchObject({ files: 1, exercises: 3, lessonsWithExercises: 2 });
  });

  it("names the file, lesson and exercise of an invalid payload", () => {
    const broken = { ...select, payload: { ...select.payload, answerIndex: 7 } };
    const report = checkShippedContent(course, [file([{ order: 1, title: "L1", exercises: [select, broken] }])]);
    expect(report.errors).toHaveLength(1);
    expect(report.errors[0]).toMatch(/pagbati\.json › lesson 1 › exercise 2/);
    expect(report.errors[0]).toMatch(/answerIndex/);
  });

  it("rejects a file whose skill is not in course.yaml", () => {
    const report = checkShippedContent(course, [file([], "bundok")]);
    expect(report.errors).toEqual([expect.stringMatching(/bundok\.json.*"bundok" is not in course\.yaml/)]);
  });

  it("rejects a lesson order the skill does not have", () => {
    const report = checkShippedContent(course, [file([{ order: 3, title: "L3", exercises: [select] }])]);
    expect(report.errors).toEqual([expect.stringMatching(/lesson 3.*only has 2 lessons/)]);
  });

  it("rejects a lesson listed twice in one file", () => {
    const report = checkShippedContent(course, [
      file([
        { order: 1, title: "L1", exercises: [select] },
        { order: 1, title: "L1 again", exercises: [typed] },
      ]),
    ]);
    expect(report.errors).toEqual([expect.stringMatching(/pagbati\.json › lesson 1: listed more than once/)]);
    expect(report.skills[0].exercises).toBe(1);
  });

  it("rejects a file that does not match the export format", () => {
    const report = checkShippedContent(course, [{ name: "pagbati.json", raw: { skill: "pagbati" } }]);
    expect(report.errors).toEqual([expect.stringMatching(/pagbati\.json: .*lessons/)]);
  });

  it("rejects two files for the same skill", () => {
    const report = checkShippedContent(course, [file([]), { ...file([]), name: "pagbati-copy.json" }]);
    expect(report.errors).toEqual([expect.stringMatching(/pagbati-copy\.json.*already shipped in pagbati\.json/)]);
  });

  it("collects reviewer warnings with their location without failing", () => {
    const twoOptions = { ...select, payload: { ...select.payload, options: ["thank you", "yes"] } };
    const report = checkShippedContent(course, [file([{ order: 1, title: "L1", exercises: [twoOptions] }])]);
    expect(report.errors).toEqual([]);
    expect(report.warnings).toEqual([expect.stringMatching(/pagbati\.json › lesson 1 › exercise 1: Only two options/)]);
  });
});

describe("grammar pattern tags and verb tables", () => {
  const tagged = (patterns: string[]) => ({ ...select, patterns });
  const realCourse = loadCourseFile(path.join(process.cwd(), "content/tagalog/course.yaml"));
  const realSkill = realCourse.units[0].skills[0].slug;
  const realFile = (exercises: unknown[]) => file([{ order: 1, title: "L1", exercises }], realSkill);

  it("accepts a tag that names a pattern in course.yaml", () => {
    const report = checkShippedContent(realCourse, [realFile([tagged(["po-opo"])])]);
    expect(report.errors).toEqual([]);
  });

  it("names the exercise whose pattern tag is not in course.yaml", () => {
    const report = checkShippedContent(realCourse, [realFile([select, tagged(["po-opo", "no-such-pattern"])])]);
    expect(report.errors).toEqual([
      expect.stringMatching(new RegExp(`${realSkill}\\.json › lesson 1 › exercise 2: .*"no-such-pattern"`)),
    ]);
  });

  describe("verbs.json", () => {
    const dirs: string[] = [];
    afterEach(() => dirs.splice(0).forEach((d) => fs.rmSync(d, { recursive: true, force: true })));

    /** A content directory holding the real course.yaml and the given verbs.json text. */
    function contentDir(verbsJson: string) {
      const dir = fs.mkdtempSync(path.join(os.tmpdir(), "shipped-"));
      dirs.push(dir);
      fs.copyFileSync(path.join(process.cwd(), "content/tagalog/course.yaml"), path.join(dir, "course.yaml"));
      fs.mkdirSync(path.join(dir, "grammar"));
      fs.writeFileSync(path.join(dir, "grammar", "verbs.json"), verbsJson);
      return dir;
    }

    it("reports a verbs.json that does not match the file format", () => {
      const report = loadShippedContent(contentDir(JSON.stringify({ verbs: [{ root: "kain" }] })));
      expect(report.errors).toEqual([expect.stringMatching(/verbs\.json/)]);
    });

    it("reports a verbs.json that is not JSON", () => {
      const report = loadShippedContent(contentDir("{ not json"));
      expect(report.errors).toEqual([expect.stringMatching(/verbs\.json/)]);
    });

    it("accepts an empty verb list", () => {
      expect(loadShippedContent(contentDir(JSON.stringify({ verbs: [] }))).errors).toEqual([]);
    });
  });
});

describe("formatContentReport", () => {
  it("renders a markdown table with a totals row", () => {
    const report = checkShippedContent(course, [file([{ order: 1, title: "L1", exercises: [select, typed] }])]);
    const md = formatContentReport(report);
    expect(md).toContain("| Greetings | 1 / 2 | 2 |");
    expect(md).toContain("| **Total** | **1 / 2** | **2** |");
    expect(md).toMatch(/select_translation\s*\|\s*1/);
  });
});

describe("the shipped Tagalog exercises", () => {
  it("all validate against course.yaml and the exercise schemas", () => {
    const report = loadShippedContent(path.join(process.cwd(), "content/tagalog"));
    expect(report.errors).toEqual([]);
    expect(report.totals.exercises).toBeGreaterThan(0);
  });
});
