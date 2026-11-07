/**
 * Prints a compact, human-readable preview of what the StubGenerator produces for each lesson.
 * Usage: npx tsx scripts/preview-content.ts [skill-slug ...]
 */
import path from "node:path";
import { loadCourseFile, lessonRequest } from "../src/lib/content/course";
import { StubGenerator } from "../src/lib/content/generators/stub";
const course = loadCourseFile(path.resolve("content/tagalog/course.yaml"));
const only = process.argv.slice(2);
(async () => {
  for (const u of course.units)
    for (const s of u.skills) {
      if (only.length && !only.includes(s.slug)) continue;
      for (let i = 0; i < s.lessons.length; i++) {
        const { exercises } = await new StubGenerator().generate(lessonRequest(s, i));
        console.log(`\n## ${s.slug} L${i + 1}`);
        for (const e of exercises) {
          const mark = (options: string[], answer: number) =>
            options.map((o, j) => (j === answer ? `*${o}*` : o)).join(" / ");
          switch (e.type) {
            case "select_translation":
              console.log("select", e.payload.prompt, "|", mark(e.payload.options, e.payload.answerIndex));
              break;
            case "fill_blank":
              console.log("fill_b", e.payload.sentence, "|", mark(e.payload.options, e.payload.answerIndex));
              break;
            case "word_bank":
              console.log(
                "wbank ",
                e.payload.prompt,
                "|",
                e.payload.answer.join(" "),
                "| alt:",
                (e.payload.alternates ?? []).map((a) => a.join(" ")).join(" ; "),
                "| x:",
                e.payload.distractors.join(","),
              );
              break;
            case "match_pairs":
              console.log("match ", e.payload.pairs.map((x) => `${x.tl}=${x.en}`).join(", "));
              break;
            case "type_translation":
              console.log("type  ", e.payload.prompt, "→", e.payload.answers.join(" | "));
              break;
          }
        }
      }
    }
})();
