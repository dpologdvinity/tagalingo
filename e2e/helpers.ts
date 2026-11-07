/**
 * E2E helpers: sign-up/sign-in flows and a database lookup of correct answers. The browser
 * never receives answers (by design), so tests read them from Postgres instead.
 */
import { expect, type Page } from "@playwright/test";
import pg from "pg";

const DATABASE_URL = process.env.DATABASE_URL ?? "postgresql://tagalingo:tagalingo@localhost:5433/tagalingo";

export async function query<T extends pg.QueryResultRow>(sql: string, params: unknown[] = []): Promise<T[]> {
  const client = new pg.Client({ connectionString: DATABASE_URL });
  await client.connect();
  try {
    return (await client.query<T>(sql, params)).rows;
  } finally {
    await client.end();
  }
}

export async function signUpFreshLearner(page: Page) {
  const email = `e2e-${Date.now()}-${Math.floor(Math.random() * 1e6)}@example.test`;
  await page.goto("/signup");
  await page.getByLabel("Your name").fill("E2E Learner");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill("correct-horse-battery");
  await page.getByRole("button", { name: "Create account" }).click();
  await page.waitForURL("**/learn");
  return email;
}

export async function logInAsDemo(page: Page) {
  await page.goto("/login");
  await page.getByRole("button", { name: "Try the demo account" }).click();
  await page.waitForURL("**/learn");
}

type ExerciseRow = { id: string; type: string; payload: Record<string, unknown> };

/** Answer whatever exercise is on screen. `wrong` deliberately answers incorrectly (not for match pairs). */
export async function answerCurrent(page: Page, { wrong = false } = {}) {
  const host = page.locator("[data-exercise-id]");
  await expect(host).toBeVisible();
  const id = await host.getAttribute("data-exercise-id");
  const [ex] = await query<ExerciseRow>(`select id, type, payload from "Exercise" where id = $1`, [id]);
  const p = ex.payload as Record<string, never>;
  switch (ex.type) {
    case "select_translation":
    case "fill_blank":
    case "listen_select":
    case "select_picture":
    case "dialogue": {
      const options = (p.options ?? p.pictures) as string[];
      const idx = wrong ? (Number(p.answerIndex) + 1) % options.length : Number(p.answerIndex);
      await page.getByRole("radio").nth(idx).click();
      break;
    }
    case "type_translation":
      await page.getByRole("textbox").fill(wrong ? "mali" : (p.answers as string[])[0]);
      break;
    case "word_bank": {
      const bank = page.getByLabel("Word bank");
      const tokens = wrong ? [(p.distractors as string[])[0] ?? "x"] : (p.answer as string[]);
      for (const t of tokens) await bank.getByRole("button", { name: t, exact: true }).first().click();
      break;
    }
    case "speak":
      // Headless browsers have no microphone: use the no-penalty skip, which submits straight away.
      await page
        .getByRole("button", { name: /Can’t speak now|^Continue$/ })
        .first()
        .click();
      return ex.type;
    case "match_pairs":
      for (const pair of p.pairs as { tl: string; en: string }[]) {
        await page.getByRole("button", { name: pair.tl, exact: true }).click();
        await page.getByRole("button", { name: pair.en, exact: true }).click();
      }
      break;
  }
  if (ex.type !== "match_pairs") await page.getByRole("button", { name: "Check" }).click();
  return ex.type;
}
