/**
 * Accessibility: every screen passes axe-core's WCAG 2.2 A/AA rules on desktop and mobile.
 *
 * Pages are scanned after they settle, signed out, as the demo reviewer, and mid-lesson
 * (the grammar card, an exercise, then its feedback panel) as a fresh learner. A failure lists each violated rule
 * with the offending elements; the full axe results are attached to the test report.
 */
import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page, type TestInfo } from "@playwright/test";
import { answerCurrent, dismissGrammarCard, logInAsDemo, query, signUpFreshLearner } from "./helpers";

const WCAG_TAGS = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"];

async function expectAccessible(page: Page, testInfo: TestInfo, label: string) {
  const results = await new AxeBuilder({ page }).withTags(WCAG_TAGS).analyze();
  await testInfo.attach(`axe-${label}.json`, {
    body: JSON.stringify(results, null, 2),
    contentType: "application/json",
  });
  const summary = results.violations.map((v) => {
    const nodes = v.nodes.map((n) => {
      // color-contrast reports the measured colours, which is what a fix needs.
      const data = n.any[0]?.data as { fgColor?: string; bgColor?: string; contrastRatio?: number } | undefined;
      const colours = data?.contrastRatio ? ` (${data.fgColor} on ${data.bgColor}: ${data.contrastRatio}:1)` : "";
      return `${n.target.join(" ")}${colours}`;
    });
    return `${v.id} (${v.impact}): ${v.help}\n    ${nodes.join("\n    ")}`;
  });
  // Soft, so one run reports every page instead of stopping at the first.
  expect.soft(summary, `${label} has accessibility violations`).toEqual([]);
}

test.describe("accessibility", () => {
  test("public pages", async ({ page }, testInfo) => {
    for (const path of ["/", "/login", "/signup"] as const) {
      await page.goto(path);
      await page.waitForLoadState("networkidle");
      await expectAccessible(page, testInfo, path);
    }
  });

  test("signed-in pages", async ({ page }, testInfo) => {
    test.slow(); // twelve pages, each loaded and scanned
    await logInAsDemo(page);
    const [skill] = await query<{ id: string }>(`select id from "Skill" where slug = 'pagbati'`);
    const paths = [
      "/learn",
      "/skills/pagbati",
      "/leaderboard",
      "/profile",
      "/chat",
      "/guide",
      "/grammar",
      "/studio",
      "/studio/grammar",
      "/studio/verbs",
      `/studio/skills/${skill.id}`,
      // The demo learner has finished lessons to practise, so no grammar card comes first.
      `/practice?skill=${skill.id}`,
    ];
    for (const path of paths) {
      await page.goto(path);
      await page.waitForLoadState("networkidle");
      await expectAccessible(page, testInfo, path);
    }
  });

  test("a lesson: grammar card, exercise and feedback", async ({ page }, testInfo) => {
    await signUpFreshLearner(page);
    await page.getByRole("button", { name: /Pagbati/ }).click();
    await page.getByRole("link", { name: "Start lesson" }).click();
    await page.waitForURL("**/lesson/**");
    // A fresh learner's first lesson opens on a grammar card: assert it, scan it, then dismiss it to reach the exercise.
    await expect(page.getByRole("button", { name: "Got it — let's try" })).toBeVisible();
    await expectAccessible(page, testInfo, "lesson-grammar-card");
    await dismissGrammarCard(page);
    await expectAccessible(page, testInfo, "lesson-exercise");

    await answerCurrent(page, { wrong: true });
    await expect(page.getByRole("button", { name: "Continue" })).toBeVisible();
    await expectAccessible(page, testInfo, "lesson-feedback");
  });
});
