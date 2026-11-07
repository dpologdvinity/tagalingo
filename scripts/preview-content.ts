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
for (const u of course.units) for (const s of u.skills) {
  if (only.length && !only.includes(s.slug)) continue;
  for (let i = 0; i < s.lessons.length; i++) {
    const { exercises } = await new StubGenerator().generate(lessonRequest(s, i));
    console.log(`\n## ${s.slug} L${i+1}`);
    for (const e of exercises) {
      const p = e.payload as any; // eslint-disable-line @typescript-eslint/no-explicit-any -- debug printer
      switch (e.type) {
        case "select_translation": case "fill_blank": console.log(e.type.slice(0,6), p.prompt ?? p.sentence, "|", p.options.map((o: string, j: number) => j === p.answerIndex ? `*${o}*` : o).join(" / ")); break;
        case "word_bank": console.log("wbank ", p.prompt, "|", p.answer.join(" "), "| alt:", (p.alternates||[]).map((a: string[]) => a.join(" ")).join(" ; "), "| x:", p.distractors.join(",")); break;
        case "match_pairs": console.log("match ", p.pairs.map((x: any) => `${x.tl}=${x.en}`).join(", ")); break;
        case "type_translation": console.log("type  ", p.prompt, "→", p.answers.join(" | ")); break;
      }
    }
  }
}})();
