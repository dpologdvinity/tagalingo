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
        const { exercises } = await new StubGenerator().generate(lessonRequest(course, s, i));
        console.log(`\n## ${s.slug} L${i + 1}`);
        for (const e of exercises) {
          // Grammar drills carry the patterns they are tagged with.
          const log = (...args: unknown[]) =>
            console.log(...args, ...(e.patterns.length ? [`[patterns: ${e.patterns.join(", ")}]`] : []));
          const mark = (options: string[], answer: number) =>
            options.map((o, j) => (j === answer ? `*${o}*` : o)).join(" / ");
          switch (e.type) {
            case "select_translation":
              log("select", e.payload.prompt, "|", mark(e.payload.options, e.payload.answerIndex));
              break;
            case "fill_blank":
              log("fill_b", e.payload.sentence, "|", mark(e.payload.options, e.payload.answerIndex));
              break;
            case "word_bank":
              log(
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
              log("match ", e.payload.pairs.map((x) => `${x.tl}=${x.en}`).join(", "));
              break;
            case "listen_select":
              log("listen", `🔊 ${e.payload.audio}`, "|", mark(e.payload.options, e.payload.answerIndex));
              break;
            case "speak":
              log("speak ", `🎤 ${e.payload.text}`, "=", e.payload.translation);
              break;
            case "dialogue":
              log(
                "dialog",
                e.payload.lines.map((l) => `${l.speaker}: ${l.tl}`).join(" / "),
                "→",
                mark(e.payload.options, e.payload.answerIndex),
              );
              break;
            case "type_translation":
              log("type  ", e.payload.prompt, "→", e.payload.answers.join(" | "));
              break;
            case "conjugate":
              log(
                "conjug",
                e.payload.sentence,
                "|",
                `${e.payload.root}/${e.payload.affix}/${e.payload.form}`,
                "→",
                e.payload.answers.join(" | "),
              );
              break;
            case "find_root":
              log(
                "root  ",
                e.payload.word,
                "|",
                e.payload.options ? mark(e.payload.options, e.payload.options.indexOf(e.payload.root)) : e.payload.root,
              );
              break;
            case "transform":
              log(
                "transf",
                e.payload.source,
                "|",
                e.payload.instruction,
                "→",
                e.payload.answers.map((a) => a.join(" ")).join(" | "),
              );
              break;
            case "paradigm":
              log(
                "paradg",
                `${e.payload.root}/${e.payload.affix}`,
                "|",
                e.payload.cells.map((c) => (c.hidden ? `_${c.value}_` : c.value)).join(", "),
              );
              break;
          }
        }
      }
    }
})();
