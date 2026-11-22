import { expect, test, type Page } from "@playwright/test";
import { createGrammarFixture, FIXTURE, removeGrammarFixture } from "./grammar-fixture";
import { answerCurrent, query, signUpFreshLearner, waitForNextStep } from "./helpers";

/** A fresh learner on the fixture lesson (the first lesson of the course, so already unlocked). */
async function openGrammarLesson(page: Page) {
  await signUpFreshLearner(page);
  await page.goto(`/lesson/${FIXTURE.lessonId}`);
}

const cardHeading = (page: Page) => page.getByRole("heading", { name: FIXTURE.patternTitle });
const gotIt = (page: Page) => page.getByRole("button", { name: "Got it — let's try" });
/** The fixture pattern's entry on the grammar page; real patterns have entries of their own. */
const fixtureEntry = (page: Page) =>
  page.getByRole("listitem").filter({ has: page.getByRole("heading", { name: FIXTURE.patternTitle }) });

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
      await waitForNextStep(page, "Lesson complete!");
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

  test("a long card opens at its title on a phone, in the lesson and in the help dialog", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await openGrammarLesson(page);

    // The card step: the page is taller than the screen, but it must not open scrolled to the button.
    await expect(cardHeading(page)).toBeInViewport();
    expect(await page.evaluate(() => document.documentElement.scrollHeight)).toBeGreaterThan(844);
    expect(await page.evaluate(() => window.scrollY)).toBe(0);
    await expect(cardHeading(page)).toBeFocused();
    await expect(gotIt(page)).not.toBeInViewport();

    // Enter still dismisses it.
    await page.keyboard.press("Enter");
    await expect(page.locator("[data-exercise-id]")).toHaveAttribute("data-exercise-id", FIXTURE.exercises.conjugate);

    // The help dialog opens at the title too, and Enter closes it.
    await page.getByRole("button", { name: `Grammar help: ${FIXTURE.patternTitle}` }).click();
    await expect(cardHeading(page)).toBeInViewport();
    await expect(page.getByRole("button", { name: "Back to the exercise" })).not.toBeInViewport();
    await page.keyboard.press("Enter");
    await expect(cardHeading(page)).toHaveCount(0);
    await expect(page.getByText("Correct answer:")).toHaveCount(0); // the Enter did not also check the answer
  });

  test("Enter on the help chip and digit keys behind the dialog leave the answer alone", async ({ page }) => {
    await openGrammarLesson(page);
    await answerCurrent(page); // conjugate (dismisses the card first)
    await page.getByRole("button", { name: "Continue" }).click();
    await answerCurrent(page); // paradigm
    await page.getByRole("button", { name: "Continue" }).click();

    // find_root, choice mode: pick the first option, then tab-style focus the chip and press Enter.
    const options = page.getByRole("radio");
    await expect(options.first()).toBeVisible();
    await options.first().click();
    const chip = page.getByRole("button", { name: `Grammar help: ${FIXTURE.patternTitle}` });
    await chip.focus();
    await page.keyboard.press("Enter");
    await expect(cardHeading(page)).toBeVisible(); // the dialog opened: Enter reached the chip, not the player
    await expect(page.getByText("Correct answer:")).toHaveCount(0);

    // Digits do nothing to the exercise behind the open dialog.
    await page.keyboard.press("3");
    await page.keyboard.press("Enter"); // closes the dialog
    await expect(cardHeading(page)).toHaveCount(0);
    await expect(options.first()).toHaveAttribute("aria-checked", "true");
    await expect(options.nth(2)).toHaveAttribute("aria-checked", "false");
    await expect(page.getByText("Correct answer:")).toHaveCount(0);
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

/** Mark the fixture lesson finished for the learner who signed up with `email`, which unlocks its pattern. */
async function finishGrammarLesson(email: string) {
  await query(`insert into "LessonProgress" ("userId", "lessonId") select id, $2 from "User" where email = $1`, [
    email,
    FIXTURE.lessonId,
  ]);
}

test.describe("grammar browsing and word lookup", () => {
  test.beforeAll(createGrammarFixture);
  test.afterAll(removeGrammarFixture);

  test("the grammar page lists unlocked patterns and practises one", async ({ page }) => {
    const email = await signUpFreshLearner(page);
    await page.goto("/grammar");
    await expect(page.getByRole("heading", { name: "Grammar", level: 1 })).toBeVisible();

    // Nothing is unlocked yet: the pattern is a title with its unlocking skill, and the weak button waits.
    const entry = fixtureEntry(page);
    await expect(entry.getByRole("heading", { name: FIXTURE.patternTitle })).toBeVisible();
    await expect(entry.getByText(`Unlocks in ${FIXTURE.skillTitle}`)).toBeVisible();
    await expect(entry.getByText("Put -um- after the first consonant")).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Practise your weakest grammar" })).toBeDisabled();
    await expect(page.getByText("Answer a few grammar drills first.")).toBeVisible();

    await finishGrammarLesson(email);
    await page.reload();
    await expect(entry.getByText(`Unlocks in ${FIXTURE.skillTitle}`)).toHaveCount(0);
    await expect(entry.getByText("Put -um- after the first consonant")).toBeVisible();
    await expect(entry.getByRole("cell", { name: "kumakain" })).toBeVisible();
    await entry.getByRole("link", { name: "Practise this" }).click();
    await page.waitForURL(`**/practice?pattern=${FIXTURE.patternSlug}`);
    await expect(page.locator("[data-exercise-id]")).toBeVisible();
  });

  test("tapping a verb in Tala's reply shows its table; unknown words show nothing", async ({ page }) => {
    await signUpFreshLearner(page);
    await page.goto("/chat");
    await page.getByRole("textbox", { name: "Message in Tagalog" }).fill("Ako si Marco.");
    await page.getByRole("button", { name: "Send" }).click();

    const reply = page.getByText("Ikinagagalak").locator("xpath=ancestor::p[1]");
    await expect(reply).toBeVisible();
    // The batch lookup marks only the verb form; names and other words stay plain.
    await expect(reply.getByRole("button", { name: "Look up makilala" })).toBeVisible();
    await expect(reply.getByRole("button", { name: /Look up (Marco|Taga-saan|ka)/ })).toHaveCount(0);

    await reply.getByRole("button", { name: "Look up makilala" }).click();
    const sheet = page.getByRole("dialog");
    await expect(sheet.getByRole("heading", { name: "makilala" })).toBeVisible();
    // A real kilala table may also list "makilala"; the fixture's own table is the one checked here.
    await expect(sheet.getByText(new RegExp(`infinitive of ${FIXTURE.lookupRoot}`))).toBeVisible();
    const table = sheet.getByRole("table", { name: new RegExp(FIXTURE.lookupRoot) });
    await expect(table).toBeVisible();
    for (const form of ["nakilala", "nakikilala", "makikilala", "kakikilala"])
      await expect(table.getByRole("cell", { name: form })).toBeVisible();
    await sheet.getByRole("button", { name: "Close" }).click();
    await expect(sheet).toBeHidden();
  });

  test("a locked pattern's line stays inline on a phone", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await signUpFreshLearner(page);
    await page.goto(`/skills/${FIXTURE.skillSlug}`);
    const title = page.locator("strong", { hasText: FIXTURE.patternTitle });
    await expect(title).toBeVisible();
    // A flex row squeezed the title into a narrow column of its own, so it wrapped onto several lines.
    const box = await title.boundingBox();
    expect(box!.height).toBeLessThan(28);
  });

  test("the skill page shows the pattern and its verb table", async ({ page }) => {
    const email = await signUpFreshLearner(page);
    // Verb tables answer the skill's drills, so they stay hidden until the lesson is finished.
    await page.goto(`/skills/${FIXTURE.skillSlug}`);
    await expect(page.getByRole("region", { name: `${FIXTURE.verbRoot} verb table` })).toHaveCount(0);

    await finishGrammarLesson(email);
    await page.goto(`/skills/${FIXTURE.skillSlug}`);

    await expect(page.getByRole("heading", { name: "Grammar", level: 2 })).toBeVisible();
    await expect(page.getByRole("heading", { name: FIXTURE.patternTitle })).toBeVisible();
    await expect(page.getByRole("link", { name: "Practise this", exact: true })).toBeVisible();
    // The verb table of the skill's exercises (e2ekain), not every table in the course.
    const table = page.getByRole("region", { name: `${FIXTURE.verbRoot} verb table` });
    await expect(table.getByRole("cell", { name: "kumakain" })).toBeVisible();
    await expect(page.getByRole("region", { name: `${FIXTURE.lookupRoot} verb table` })).toHaveCount(0);

    // The path placard lists the pattern on the skill's stop.
    await page.goto("/learn");
    await page.getByRole("button", { name: new RegExp(`^${FIXTURE.skillTitle}:`) }).click();
    await expect(page.getByRole("list", { name: "Grammar patterns" }).getByText(FIXTURE.patternTitle)).toBeVisible();
  });
});
