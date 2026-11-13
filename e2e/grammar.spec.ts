import { expect, test, type Page } from "@playwright/test";
import { createGrammarFixture, FIXTURE, removeGrammarFixture } from "./grammar-fixture";
import { answerCurrent, signUpFreshLearner } from "./helpers";

/** A fresh learner on the fixture lesson (the first lesson of the course, so already unlocked). */
async function openGrammarLesson(page: Page) {
  await signUpFreshLearner(page);
  await page.goto(`/lesson/${FIXTURE.lessonId}`);
}

const cardHeading = (page: Page) => page.getByRole("heading", { name: FIXTURE.patternTitle });
const gotIt = (page: Page) => page.getByRole("button", { name: "Got it — let's try" });

test.describe("grammar player", () => {
  test.beforeAll(createGrammarFixture);
  test.afterAll(removeGrammarFixture);

  test("a grammar card appears once and the chip reopens it", async ({ page }) => {
    await openGrammarLesson(page);

    // The card comes first, with its rule and table, and the drills follow it.
    await expect(cardHeading(page)).toBeVisible();
    await expect(page.getByText("Put -um- after the first consonant")).toBeVisible();
    await expect(page.getByRole("cell", { name: "kumakain" })).toBeVisible();
    await expect(page.locator("[data-exercise-id]")).toHaveCount(0);
    await gotIt(page).click();
    await expect(page.locator("[data-exercise-id]")).toHaveAttribute("data-exercise-id", FIXTURE.exercises.conjugate);

    const seen: string[] = [];
    while (!(await page.getByText("Lesson complete!").isVisible())) {
      seen.push(await answerCurrent(page));
      await page.getByRole("button", { name: "Continue" }).click();
      await expect(page.locator("[data-exercise-id]").or(page.getByText("Lesson complete!"))).toBeVisible();
    }
    expect(seen).toEqual(["conjugate", "paradigm", "find_root", "transform"]);

    // Replaying: the card is no longer new, so the lesson opens on a drill and the chip has it.
    await page.goto(`/lesson/${FIXTURE.lessonId}`);
    await expect(page.locator("[data-exercise-id]")).toBeVisible();
    await expect(cardHeading(page)).toHaveCount(0);
    await page.getByRole("button", { name: `Grammar help: ${FIXTURE.patternTitle}` }).click();
    await expect(cardHeading(page)).toBeVisible();
    await expect(page.getByRole("cell", { name: "kumakain" })).toBeVisible();
    await page.getByRole("button", { name: "Back to the exercise" }).click();
    await expect(cardHeading(page)).toHaveCount(0);
  });

  test("conjugate feedback names the wrong form", async ({ page }) => {
    await openGrammarLesson(page);
    await gotIt(page).click();
    await page.getByRole("textbox", { name: "Your answer" }).fill("kumakain");
    await page.getByRole("button", { name: "Check" }).click();
    await expect(page.getByText("Correct answer:")).toBeVisible();
    await expect(page.getByText(/That's the present form \(kumakain\)\. The past is kumain\./)).toBeVisible();
  });

  test("paradigm marks the wrong cells", async ({ page }) => {
    await openGrammarLesson(page);
    await answerCurrent(page); // conjugate, correct (dismisses the card first)
    await page.getByRole("button", { name: "Continue" }).click();

    await expect(page.getByText("Fill in the verb table")).toBeVisible();
    await answerCurrent(page, { wrong: true }); // a distractor goes into the first hidden cell
    await expect(page.getByText("Correct answer:")).toBeVisible();
    await expect(page.getByRole("button", { name: "present cell" })).toHaveClass(/border-gumamela/);
    await expect(page.getByRole("button", { name: "future cell" })).not.toHaveClass(/border-gumamela/);
  });
});
