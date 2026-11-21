/**
 * Page-weight budgets: how much JavaScript (compressed, as sent over the wire) each key screen
 * loads on a cold visit. Request counts are reported but not budgeted: route prefetching makes
 * them vary from run to run.
 *
 * Each page is opened in a fresh browser context so nothing comes from cache. The test fails
 * when a page goes over its budget, prints a table to the GitHub job summary when
 * GITHUB_STEP_SUMMARY is set, and attaches the numbers as JSON. Budgets sit roughly 15% above
 * the measured size so normal growth passes but a heavy new dependency doesn't; raise one on
 * purpose, in the same PR that explains why.
 */
import fs from "node:fs";
import { expect, test, type Browser, type Page } from "@playwright/test";
import { logInAsDemo, query } from "./helpers";

const KB = 1024;

type Measurement = { label: string; path: string; jsKb: number; budgetKb: number; requests: number };

/** Load `path` cold in a new context and sum the compressed size of every script it fetched. */
async function measure(browser: Browser, path: string, prepare?: (page: Page) => Promise<void>) {
  const context = await browser.newContext();
  const page = await context.newPage();
  if (prepare) await prepare(page);
  // A new page in the same context still shares the HTTP cache, so clear it after signing in.
  const cdp = await context.newCDPSession(page);
  await cdp.send("Network.clearBrowserCache");

  const scripts: Promise<number>[] = [];
  let requests = 0;
  page.on("requestfinished", (request) => {
    requests += 1;
    if (request.resourceType() === "script") {
      scripts.push(request.sizes().then((s) => s.responseBodySize));
    }
  });
  await page.goto(path);
  await page.waitForLoadState("networkidle");
  const bytes = (await Promise.all(scripts)).reduce((a, b) => a + b, 0);
  await context.close();
  return { jsKb: Math.round(bytes / KB), requests };
}

/** Markdown table for the GitHub job summary. */
function summaryTable(results: Measurement[]): string {
  const rows = results.map((r) => {
    const status = r.jsKb <= r.budgetKb ? "✅" : "❌";
    const pct = Math.round((r.jsKb / r.budgetKb) * 100);
    return `| ${status} ${r.label} | \`${r.path.replace(/\/lesson\/.+/, "/lesson/…")}\` | ${r.jsKb} KB | ${r.budgetKb} KB (${pct}%) | ${r.requests} |`;
  });
  return [
    "## Page weight",
    "",
    "Compressed JavaScript loaded on a cold visit (desktop).",
    "",
    "| Screen | Path | JavaScript | Budget | Requests |",
    "| --- | --- | --- | --- | --- |",
    ...rows,
    "",
  ].join("\n");
}

test.describe("page weight", () => {
  // Bundles are identical across viewports; measure once.
  test.skip(({ isMobile }) => isMobile, "desktop only");

  test("key screens stay within their JavaScript budgets", async ({ browser }, testInfo) => {
    const [lesson] = await query<{ id: string }>(
      `select l.id from "Lesson" l join "Skill" s on s.id = l."skillId" where s.slug = 'pagbati' and l."order" = 1`,
    );
    const pages: { label: string; path: string; budgetKb: number; prepare?: (page: Page) => Promise<void> }[] = [
      { label: "Landing", path: "/", budgetKb: 165 },
      { label: "Log in", path: "/login", budgetKb: 160 },
      { label: "Skill path", path: "/learn", budgetKb: 165, prepare: logInAsDemo },
      { label: "Lesson", path: `/lesson/${lesson.id}`, budgetKb: 170, prepare: logInAsDemo },
      { label: "Skill page", path: "/skills/pagbati", budgetKb: 165, prepare: logInAsDemo },
      { label: "Leaderboard", path: "/leaderboard", budgetKb: 160, prepare: logInAsDemo },
      { label: "Studio", path: "/studio", budgetKb: 160, prepare: logInAsDemo },
    ];

    const results: Measurement[] = [];
    for (const p of pages) {
      const { jsKb, requests } = await measure(browser, p.path, p.prepare);
      results.push({ label: p.label, path: p.path, jsKb, budgetKb: p.budgetKb, requests });
    }

    await testInfo.attach("page-weight.json", {
      body: JSON.stringify(results, null, 2),
      contentType: "application/json",
    });
    if (process.env.GITHUB_STEP_SUMMARY) fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY, summaryTable(results));
    for (const r of results) {
      expect.soft(r.jsKb, `${r.label} (${r.path}) loads ${r.jsKb} KB of JavaScript`).toBeLessThanOrEqual(r.budgetKb);
    }
  });
});
