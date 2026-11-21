/**
 * Answer secrecy, checked on the wire.
 *
 * Unit and integration tests prove that `toClientExercise` strips answers. This proves the app
 * actually uses it: it records every document, RSC and server-action response the browser
 * receives while a lesson (and a practice session) loads, up to the moment before the first
 * answer is checked, and fails if any of them carries
 *   - an answer-bearing payload key (`answerIndex`, `answers`, `answer`, `alternates`,
 *     `distractors`, `replyEn`), or
 *   - a withheld value, serialised the way a leak would serialise it: the accepted typed
 *     translations (as the whole array and one by one), the word-bank answer, alternates and
 *     distractor lists, and a dialogue reply's English. Values that are legitimately visible in
 *     some exercise's client view are skipped, as are single strings under four characters
 *     ("oo", "no"), which collide with unrelated props; arrays catch those instead.
 */
import { expect, test, type Page, type Response } from "@playwright/test";
import { toClientExercise } from "../src/lib/content/client-view";
import { parseExercise, type ExerciseType, type ParsedExercise } from "../src/lib/content/schema";
import { logInAsDemo, query, signUpFreshLearner } from "./helpers";

const SECRET_KEY = /\\?"(answerIndex|answers|answer|alternates|distractors|replyEn)\\?"\s*:/;
const MIN_SECRET_LENGTH = 4;

/** A JSON string literal as a regex source, matching it plain or escaped inside an RSC payload. */
function jsonStringSource(value: string): string {
  const inner = JSON.stringify(value)
    .slice(1, -1)
    .replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return `\\\\?"${inner}\\\\?"`;
}

/** Matches a string, or an array of strings, serialised as a complete JSON value. */
function asJson(value: string | string[]): RegExp {
  if (typeof value === "string") return new RegExp(jsonStringSource(value));
  return new RegExp(`\\[${value.map(jsonStringSource).join(",")}\\]`);
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

/** Every string and string-array in a value, so values a learner may legitimately see can be excluded. */
function visibleValues(value: unknown, out = new Set<string>()): Set<string> {
  if (typeof value === "string") out.add(JSON.stringify(value));
  else if (Array.isArray(value)) {
    if (value.every((v) => typeof v === "string")) out.add(JSON.stringify(value));
    value.forEach((v) => visibleValues(v, out));
  } else if (value && typeof value === "object") Object.values(value).forEach((v) => visibleValues(v, out));
  return out;
}

/** Values the server knows but deliberately never sends before grading. */
function withheld(ex: ParsedExercise): (string | string[])[] {
  switch (ex.type) {
    case "type_translation":
      return [ex.payload.answers, ...ex.payload.answers];
    case "word_bank":
      return [ex.payload.answer, ex.payload.distractors, ...(ex.payload.alternates ?? [])].filter((a) => a.length);
    case "dialogue":
      return [ex.payload.replyEn];
    default:
      return [];
  }
}

/** Long enough to search for without matching unrelated props by accident. */
const distinctive = (value: string | string[]) =>
  typeof value === "string"
    ? value.length >= MIN_SECRET_LENGTH
    : value.length > 1 || value[0].length >= MIN_SECRET_LENGTH;

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
  const parsed = exercises.map((e) => ({ id: e.id, ex: parseExercise(e.type as ExerciseType, e.payload) }));
  const visible = new Set<string>();
  for (const { id, ex } of parsed) visibleValues(toClientExercise(id, ex), visible);
  const secrets = new Map<string, string | string[]>();
  for (const { ex } of parsed) {
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
    await expect(page.locator("[data-exercise-id]")).toBeVisible();
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
    await expect(page.locator("[data-exercise-id]")).toBeVisible();
    const captured = await stop();

    const exercises = await query<{ id: string; type: string; payload: unknown }>(
      `select e.id, e.type, e.payload from "Exercise" e join "Lesson" l on l.id = e."lessonId"
       where l."skillId" = $1 and e.status = 'APPROVED'`,
      [skill.id],
    );
    await expectNoLeaks(captured, `/practice?skill=${skill.id}`, exercises);
  });
});
