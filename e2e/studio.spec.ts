import { expect, test } from "@playwright/test";
import { createGrammarFixture, FIXTURE, removeGrammarFixture } from "./grammar-fixture";
import { logInAsDemo } from "./helpers";

// The specs change the fixture (approve a table, flag a card), so each one starts from a fresh copy.
test.describe("studio grammar review", () => {
  test.beforeEach(createGrammarFixture);
  test.afterAll(removeGrammarFixture);

  test("the studio verb grid approves a table", async ({ page }) => {
    await logInAsDemo(page);
    await page.goto("/studio");
    await page.getByRole("link", { name: "Verb tables" }).click();
    await expect(page.getByRole("heading", { name: "Verb tables", level: 1 })).toBeVisible();
    // Other drafts may exist; "All" keeps the card on screen after it is approved.
    await page.getByRole("link", { name: /^All \(/ }).click();
    await page.waitForURL("**/studio/verbs?status=all");

    const card = page.getByRole("region", { name: `${FIXTURE.verbRoot}, mag` });
    await expect(card.getByRole("heading", { name: `${FIXTURE.verbRoot} · mag` })).toBeVisible();
    await expect(card.getByText("Draft", { exact: true })).toBeVisible();
    await expect(card.getByLabel("past")).toHaveValue("nagkain");

    // One form per row: the card never needs more width than the phone has.
    await page.setViewportSize({ width: 390, height: 844 });
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    expect(overflow).toBeLessThanOrEqual(0);

    await card.getByRole("button", { name: "Approve" }).click();
    await expect(card.getByText("Approved", { exact: true })).toBeVisible();
    await expect(card.getByText("Draft", { exact: true })).toHaveCount(0);
  });

  test("the studio grammar tab flags and resolves a card", async ({ page }) => {
    await logInAsDemo(page);
    await page.goto("/studio/grammar");
    await expect(page.getByRole("heading", { name: "Grammar cards", level: 1 })).toBeVisible();

    const card = page.getByRole("region", { name: FIXTURE.patternTitle });
    await expect(card.getByText("Put -um- after the first consonant")).toBeVisible();
    await expect(card.getByText("4 drills tagged")).toBeVisible();

    await card.getByLabel("Flag a problem").fill("The table skips the recent form");
    await card.getByRole("button", { name: `Flag ${FIXTURE.patternTitle}` }).click();
    const open = page.getByRole("region", { name: /Open flags/ });
    await expect(open.getByText("The table skips the recent form")).toBeVisible();
    await expect(open.getByRole("heading", { name: "Open flags (1)" })).toBeVisible();

    await open.getByRole("button", { name: "Resolve" }).click();
    await expect(open.getByRole("heading", { name: "Open flags (0)" })).toBeVisible();
    const resolved = card.locator("details", { hasText: "Resolved (1)" });
    await resolved.getByText("Resolved (1)").click();
    await expect(resolved.getByText("The table skips the recent form")).toBeVisible();
  });

  test("the studio preview shows grammar drills and their patterns", async ({ page }) => {
    await logInAsDemo(page);
    await page.goto(`/studio/skills/${FIXTURE.skillSlug}?status=all`);

    const conjugate = page.getByRole("listitem").filter({ hasText: "___ ako ng kanin kahapon." });
    await expect(conjugate.getByText("Accepted answers:")).toBeVisible();
    await expect(conjugate.getByText("kumain", { exact: true })).toBeVisible();
    await expect(conjugate.getByText(FIXTURE.patternTitle, { exact: true })).toBeVisible();

    const paradigm = page.getByRole("listitem").filter({ hasText: "hidden from the learner" });
    await expect(paradigm.getByText("kumaen")).toBeVisible();

    // The tag editor lists the course's patterns and can clear a tag.
    await conjugate.getByRole("button", { name: "Edit patterns" }).click();
    await conjugate.getByRole("checkbox", { name: FIXTURE.patternTitle }).uncheck();
    await conjugate.getByRole("button", { name: "Save patterns" }).click();
    await expect(conjugate.getByText("Patterns cleared.")).toBeVisible();
    await expect(conjugate.getByText("none", { exact: true })).toBeVisible();
  });
});
