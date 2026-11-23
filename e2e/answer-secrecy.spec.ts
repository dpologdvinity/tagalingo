/**
 * Answer secrecy, checked on the wire.
 *
 * Unit and integration tests prove that `toClientExercise` strips answers. This proves the app
 * actually uses it: it records every document, RSC and server-action response the browser
 * receives while a lesson (and a practice session) loads, up to the moment before the first
 * answer is checked, and fails if any of them carries
 *   - an answer-bearing payload key (`answerIndex`, `answers`, `answer`, `alternates`,
 *     `distractors`, `replyEn`, `hint`), or
 *   - a withheld value, serialised the way a leak would serialise it: the accepted typed
 *     translations (as the whole array and one by one), the word-bank answer, alternates and
 *     distractor lists, and a dialogue reply's English. Values a learner legitimately sees in
 *     another exercise are skipped, as are single strings under four characters ("oo", "no"),
 *     which collide with unrelated props; arrays catch those instead. A paradigm's hidden cells
 *     are looked for as `{"form":..,"value":..}` pairs, which is how a leak of the cells with
 *     their values filled in would serialise.
 *
 * What counts as visible is spelled out per exercise type below (`publicValues`), independently
 * of `toClientExercise`: deriving it from the code under test would let a leak whitelist itself.
 */
import { expect, test, type Page, type Response } from "@playwright/test";
import { parseExercise, type ExerciseType, type ParsedExercise } from "../src/lib/content/schema";
import { createGrammarFixture, FIXTURE, removeGrammarFixture } from "./grammar-fixture";
import { dismissGrammarCard, logInAsDemo, query, signUpFreshLearner } from "./helpers";

const SECRET_KEY = /\\?"(answerIndex|answers|answer|alternates|distractors|replyEn|hint)\\?"\s*:/;
const MIN_SECRET_LENGTH = 4;

/** A JSON string literal as a regex source, matching it plain or escaped inside an RSC payload. */
function jsonStringSource(value: string): string {
  const inner = JSON.stringify(value)
    .slice(1, -1)
    .replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return `\\\\?"${inner}\\\\?"`;
}

/** A value the server keeps back: a string, a list of strings, or a table cell (`form` and its `value`). */
type Withheld = string | string[] | { form: string; value: string };

/**
 * Matches a withheld value serialised as a complete JSON value. A cell matches from its opening
 * brace through `value`, so extra keys after it (`hidden`) still count as a leak.
 */
function asJson(value: Withheld): RegExp {
  if (typeof value === "string") return new RegExp(jsonStringSource(value));
  if (Array.isArray(value)) return new RegExp(`\\[${value.map(jsonStringSource).join(",")}\\]`);
  const [form, formValue] = [value.form, value.value].map(jsonStringSource);
  return new RegExp(`\\{${jsonStringSource("form")}:${form},${jsonStringSource("value")}:${formValue}`);
}

/** `prefetch` marks Next's speculative route fetches, which the browser may abandon unread. */
type Captured = { url: string; body: string | null; prefetch: boolean };

/** How long to wait for a body. Route prefetches the browser abandons never finish streaming. */
const BODY_TIMEOUT_MS = 10_000;

/**
 * Record text bodies of document/fetch responses until `stop()` is called. A body that can't be
 * read in time comes back as `null` so the caller can decide whether it matters.
 */
function recordResponses(page: Page) {
  const pending: Promise<Captured>[] = [];
  let recording = true;
  const onResponse = (response: Response) => {
    if (!recording) return;
    if (!["document", "fetch", "xhr"].includes(response.request().resourceType())) return;
    if (response.status() >= 300 && response.status() < 400) return; // redirects have no body
    const url = response.url();
    const prefetch = response.request().headers()["next-router-prefetch"] !== undefined;
    const timeout = new Promise<null>((resolve) => setTimeout(() => resolve(null), BODY_TIMEOUT_MS));
    pending.push(Promise.race([response.text().catch(() => null), timeout]).then((body) => ({ url, body, prefetch })));
  };
  page.on("response", onResponse);
  return async () => {
    recording = false;
    page.off("response", onResponse);
    return Promise.all(pending);
  };
}

/**
 * The fields a learner is meant to see before answering, per exercise type, as JSON strings: each
 * string, plus whole option lists. Word-bank tiles are public one by one, but only as a shuffled
 * mix, so the answer and distractor lists stay secret.
 */
function publicValues(ex: ParsedExercise): string[] {
  const values: (string | string[])[] = (() => {
    switch (ex.type) {
      case "select_translation":
        return [ex.payload.prompt, ex.payload.options, ...ex.payload.options];
      case "fill_blank":
        return [ex.payload.sentence, ex.payload.translation, ex.payload.options, ...ex.payload.options];
      case "word_bank":
        return [ex.payload.prompt, ...ex.payload.answer, ...ex.payload.distractors];
      case "match_pairs":
        return ex.payload.pairs.flatMap((p) => [p.tl, p.en]);
      case "type_translation":
        return [ex.payload.prompt];
      case "listen_select":
        return [ex.payload.audio, ex.payload.options, ...ex.payload.options];
      case "speak":
        return [ex.payload.text, ex.payload.translation];
      case "dialogue":
        return [...ex.payload.lines.flatMap((l) => [l.tl, l.en]), ex.payload.options, ...ex.payload.options];
      case "conjugate":
        return [ex.payload.sentence, ex.payload.translation, ex.payload.root, ex.payload.affix, ex.payload.form];
      case "find_root":
        return [
          ex.payload.word,
          ...(ex.payload.translation ? [ex.payload.translation] : []),
          ...(ex.payload.options ?? []),
        ];
      case "transform":
        // Build mode shows the answer's tokens and the distractors as one shuffled tile bank.
        return [
          ex.payload.source,
          ex.payload.sourceEn,
          ex.payload.instruction,
          ...(ex.payload.mode === "build" ? [...ex.payload.answers[0]!, ...ex.payload.distractors] : []),
        ];
      case "paradigm":
        return [
          ex.payload.root,
          ex.payload.affix,
          ex.payload.en,
          ...ex.payload.cells.flatMap((c) => [c.form, c.value]),
          ...ex.payload.distractors,
        ];
    }
  })();
  return values.map((v) => JSON.stringify(v));
}

/** Values the server knows but deliberately never sends before grading. */
function withheld(ex: ParsedExercise): Withheld[] {
  switch (ex.type) {
    case "type_translation":
      return [ex.payload.answers, ...ex.payload.answers];
    case "word_bank":
      // Without distractors the tiles are just the answer reshuffled, so its order is all that's secret
      // and the shuffle may reproduce it; only look for the answer list when distractors exist.
      return [
        ...(ex.payload.distractors.length ? [ex.payload.answer, ex.payload.distractors] : []),
        ...(ex.payload.alternates ?? []),
      ];
    case "dialogue":
      return [ex.payload.replyEn];
    case "conjugate":
      return [ex.payload.answers, ...ex.payload.answers];
    case "find_root":
      // In choice mode the root is one of the visible options, so only type mode keeps it secret.
      return [ex.payload.root, ex.payload.hint];
    case "transform":
      // As with word_bank: only the order of a build answer is secret, and the shuffle may reproduce it.
      // A typed answer is also looked for as the string the learner would type.
      return [
        ...(ex.payload.mode === "type" || ex.payload.distractors.length ? ex.payload.answers : []),
        ...(ex.payload.mode === "type" ? ex.payload.answers.map((a) => a.join(" ")) : []),
        ...(ex.payload.distractors.length ? [ex.payload.distractors] : []),
      ];
    case "paradigm": {
      // The hidden values are tiles, so their order in the table (and the distractor list) is what's secret.
      const hiddenCells = ex.payload.cells.filter((c) => c.hidden);
      // Which tile belongs in which cell is secret too: a cell sent with its value filled in is a leak,
      // and no shuffle of the tiles can produce that pair.
      const cells = hiddenCells.map(({ form, value }) => ({ form, value }));
      return [
        ...cells,
        ...(ex.payload.distractors.length ? [hiddenCells.map((c) => c.value), ex.payload.distractors] : []),
      ];
    }
    default:
      return [];
  }
}

/** Long enough to search for without matching unrelated props by accident. */
const distinctive = (value: Withheld) => {
  if (typeof value === "string") return value.length >= MIN_SECRET_LENGTH;
  if (Array.isArray(value)) return value.length > 1 || value[0].length >= MIN_SECRET_LENGTH;
  return true; // a `{"form":..,"value":..}` pair is specific enough whatever the cell says
};

/** A page's identity: path and query, minus Next's `_rsc` cache-busting parameter. */
function pageKey(url: string): string {
  const u = new URL(url);
  u.searchParams.delete("_rsc");
  return u.pathname + u.search;
}

/**
 * `sessionPath` is the page the exercises belong to: its document, RSC payload and server-action
 * responses must all be readable. Unreadable responses for other routes are abandoned prefetches.
 */
async function expectNoLeaks(
  captured: Captured[],
  sessionPath: string,
  exercises: { id: string; type: string; payload: unknown }[],
) {
  const onSession = captured.filter((c) => pageKey(c.url) === sessionPath);
  expect(onSession.length, `no responses were recorded for ${sessionPath}`).toBeGreaterThan(0);
  // An abandoned prefetch has no body to check; every other session response must be readable.
  const unread = onSession.filter((c) => c.body === null && !c.prefetch).map((c) => c.url);
  expect(unread, "responses for the session page that could not be read").toEqual([]);
  const parsed = exercises.map((e) => parseExercise(e.type as ExerciseType, e.payload));
  const visible = new Set(parsed.flatMap(publicValues));
  const secrets = new Map<string, Withheld>();
  for (const ex of parsed) {
    for (const value of withheld(ex)) {
      const json = JSON.stringify(value);
      if (!visible.has(json) && distinctive(value)) secrets.set(json, value);
    }
  }
  expect(secrets.size, "the session has no withheld values to look for").toBeGreaterThan(0);

  for (const { url, body } of captured) {
    if (body === null) continue;
    expect(body, `${url} sends an answer key`).not.toMatch(SECRET_KEY);
    for (const [json, value] of secrets) {
      expect(body, `${url} sends the withheld answer ${json}`).not.toMatch(asJson(value));
    }
  }
}

test.describe("answer secrecy on the wire", () => {
  // The network traffic is the same on every viewport.
  test.skip(({ isMobile }) => isMobile, "desktop only");

  test("starting a lesson sends no answers", async ({ page }) => {
    await signUpFreshLearner(page);
    await page.getByRole("button", { name: /Pagbati/ }).click();
    const stop = recordResponses(page);
    await page.getByRole("link", { name: "Start lesson" }).click();
    await page.waitForURL("**/lesson/**");
    await dismissGrammarCard(page); // a grammar card may come first; the exercise behind it is what's under test
    const captured = await stop();

    const sessionPath = pageKey(page.url());
    const lessonId = sessionPath.split("/").pop();
    const exercises = await query<{ id: string; type: string; payload: unknown }>(
      `select id, type, payload from "Exercise" where "lessonId" = $1 and status = 'APPROVED'`,
      [lessonId],
    );
    await expectNoLeaks(captured, sessionPath, exercises);
  });

  test("starting a practice session sends no answers", async ({ page }) => {
    await logInAsDemo(page); // the demo learner has finished lessons to practise
    const [skill] = await query<{ id: string }>(`select id from "Skill" where slug = 'pagbati'`);
    const stop = recordResponses(page);
    await page.goto(`/practice?skill=${skill.id}`);
    await dismissGrammarCard(page); // a grammar card may come first; the exercise behind it is what's under test
    const captured = await stop();

    const exercises = await query<{ id: string; type: string; payload: unknown }>(
      `select e.id, e.type, e.payload from "Exercise" e join "Lesson" l on l.id = e."lessonId"
       where l."skillId" = $1 and e.status = 'APPROVED'`,
      [skill.id],
    );
    await expectNoLeaks(captured, `/practice?skill=${skill.id}`, exercises);
  });

  // The shipped Pagbati lesson holds one grammar exercise, so the grammar types get their own lesson: the
  // fixture has a conjugate, a paradigm, a find_root (choice) and a transform (build) drill.
  test.describe("a grammar lesson", () => {
    test.beforeAll(createGrammarFixture);
    test.afterAll(removeGrammarFixture);

    test("starting it sends no conjugate, paradigm, find-root or transform answers", async ({ page }) => {
      await signUpFreshLearner(page);
      const stop = recordResponses(page);
      await page.goto(`/lesson/${FIXTURE.lessonId}`);
      await dismissGrammarCard(page);
      const captured = await stop();

      const exercises = await query<{ id: string; type: string; payload: unknown }>(
        `select id, type, payload from "Exercise" where "lessonId" = $1 and status = 'APPROVED'`,
        [FIXTURE.lessonId],
      );
      expect(exercises.map((e) => e.type).sort()).toEqual(["conjugate", "find_root", "paradigm", "transform"]);
      await expectNoLeaks(captured, pageKey(page.url()), exercises);
    });
  });
});
