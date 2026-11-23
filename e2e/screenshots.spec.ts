/**
 * Screenshots of the key screens for pull-request review, on desktop and mobile.
 *
 * Only runs when SCREENSHOTS_DIR is set (CI sets it); images are written to
 * `$SCREENSHOTS_DIR/<project>/<nn>-<screen>.png` and the "PR screenshots" job in ci.yml posts
 * them on the pull request. These are pictures, not assertions: a screen that fails to render
 * fails the spec that covers it elsewhere.
 */
import path from "node:path";
import { expect, test, type Page } from "@playwright/test";
import { answerCurrent, dismissGrammarCard, logInAsDemo, query, signUpFreshLearner } from "./helpers";

const DIR = process.env.SCREENSHOTS_DIR;

test.describe("screenshots", () => {
  test.skip(!DIR, "set SCREENSHOTS_DIR to capture screenshots");

  async function shoot(page: Page, project: string, name: string) {
    // Not "networkidle": abandoned route prefetches can keep the network busy indefinitely.
    await page.waitForLoadState("load");
    // Let fonts and entrance animations finish so the shot shows the settled screen. Infinite
    // animations (pulsing badges) never finish, so only finite ones are awaited.
    await page.evaluate(async () => {
      await document.fonts.ready;
      const finite = document.getAnimations().filter((a) => a.effect?.getComputedTiming().iterations !== Infinity);
      await Promise.all(finite.map((a) => a.finished.catch(() => undefined)));
    });
    await page.screenshot({ path: path.join(DIR!, project, `${name}.png`) });
  }

  test("key screens", async ({ page }, testInfo) => {
    const project = testInfo.project.name;

    await page.goto("/");
    await shoot(page, project, "01-landing");

    await logInAsDemo(page);
    await shoot(page, project, "02-learn");
    await page.goto("/skills/pagbati");
    await shoot(page, project, "03-skill");
    await page.goto("/leaderboard");
    await shoot(page, project, "04-leaderboard");
    await page.goto("/profile");
    await shoot(page, project, "05-profile");
    const [skill] = await query<{ id: string }>(`select id from "Skill" where slug = 'pagbati'`);
    await page.goto(`/studio/skills/${skill.id}`);
    await shoot(page, project, "06-studio");
    await page.goto("/studio/verbs");
    await shoot(page, project, "09-studio-verbs");
    await page.goto("/grammar");
    await shoot(page, project, "10-grammar");

    // A lesson as a fresh learner: the first exercise, then the feedback for a wrong answer.
    await page.context().clearCookies();
    await signUpFreshLearner(page);
    await page.getByRole("button", { name: /Pagbati/ }).click();
    await page.getByRole("link", { name: "Start lesson" }).click();
    await page.waitForURL("**/lesson/**");
    await dismissGrammarCard(page); // the first drill may be behind a grammar card
    await shoot(page, project, "07-lesson");
    await answerCurrent(page, { wrong: true });
    await expect(page.getByRole("button", { name: "Continue" })).toBeVisible();
    await shoot(page, project, "08-feedback");
  });
});
