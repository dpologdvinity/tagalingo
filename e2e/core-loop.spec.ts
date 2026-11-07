import { expect, test } from "@playwright/test";
import { answerCurrent, logInAsDemo, query, signUpFreshLearner } from "./helpers";

test.describe("core loop", () => {
  test("a new learner signs up, finishes the first lesson and earns XP", async ({ page }) => {
    const email = await signUpFreshLearner(page);
    await page.getByRole("button", { name: /Pagbati/ }).click();
    await page.getByRole("link", { name: "Start lesson" }).click();
    await page.waitForURL("**/lesson/**");

    const seen = new Set<string>();
    let firstWrongDone = false;
    while (!(await page.getByText("Lesson complete!").isVisible())) {
      // Make one deliberate mistake on the first non-matching exercise to exercise the re-queue.
      const isMatch = await page.getByText("Match the pairs").isVisible();
      const wrong = !firstWrongDone && !isMatch;
      seen.add(await answerCurrent(page, { wrong }));
      if (wrong) {
        await expect(page.getByText("Correct answer:")).toBeVisible();
        firstWrongDone = true;
      }
      await page.getByRole("button", { name: "Continue" }).click();
      // Next exercise, or (after a short save) the results screen.
      await expect(page.locator("[data-exercise-id]").or(page.getByText("Lesson complete!"))).toBeVisible();
    }

    expect(seen.size).toBeGreaterThanOrEqual(4); // mixed exercise types
    await expect(page.getByText("+10 XP")).toBeVisible();
    await expect(page.getByText("First time")).toBeVisible();
    await expect(page.getByText("You started a streak.")).toBeVisible();

    const [user] = await query<{ totalXp: number; currentStreak: number; hearts: number }>(
      `select "totalXp", "currentStreak", hearts from "User" where email = $1`,
      [email],
    );
    expect(user).toMatchObject({ totalXp: 15, currentStreak: 1, hearts: 4 });

    await page.getByRole("link", { name: "Continue" }).click();
    await page.waitForURL("**/learn");
    await page.getByRole("button", { name: /Pagbati/ }).click();
    await expect(page.getByRole("link", { name: "Continue" })).toBeVisible(); // lesson 2 unlocked
  });

  test("running out of hearts ends the lesson and shows the refill timer", async ({ page }) => {
    const email = await signUpFreshLearner(page);
    await query(`update "User" set hearts = 1, "heartsUpdatedAt" = now() where email = $1`, [email]);
    await page.getByRole("button", { name: /Pagbati/ }).click();
    await page.getByRole("link", { name: "Start lesson" }).click();
    await page.waitForURL("**/lesson/**");
    await answerCurrent(page, { wrong: true });
    await expect(page.getByText("That was your last heart.")).toBeVisible();
    await page.getByRole("button", { name: "Continue" }).click();
    await expect(page.getByRole("heading", { name: "You’re out of hearts" })).toBeVisible();
    await expect(page.getByText(/Your next one arrives in \d+:\d\d/)).toBeVisible();
  });

  test("locked lessons redirect back to the path", async ({ page }) => {
    await signUpFreshLearner(page);
    const [locked] = await query<{ id: string }>(
      `select l.id from "Lesson" l join "Skill" s on s.id = l."skillId" where s.slug = 'mga-numero' and l."order" = 1`,
    );
    await page.goto(`/lesson/${locked.id}`);
    await page.waitForURL("**/learn");
  });
});

test.describe("screens", () => {
  test("leaderboard, profile and studio render for the demo reviewer", async ({ page }) => {
    await logInAsDemo(page);
    await page.goto("/leaderboard");
    await expect(page.getByRole("heading", { level: 1, name: "Barkada League" })).toBeVisible();
    await expect(page.getByText("Demo Learner (you)")).toBeVisible();

    await page.goto("/profile");
    await expect(page.getByRole("heading", { name: "Demo Learner" })).toBeVisible();
    await expect(page.getByText(/active days in the last 12 weeks/)).toBeVisible();

    await page.goto("/studio");
    await expect(page.getByRole("heading", { name: "Content studio" })).toBeVisible();
    await page.getByRole("link", { name: /Pamimili/ }).click();
    await expect(page.getByRole("heading", { name: /Lesson 1/ })).toBeVisible();
  });

  test("the studio is hidden from regular learners", async ({ page }) => {
    await signUpFreshLearner(page);
    const res = await page.goto("/studio");
    expect(res?.status()).toBe(404);
  });

  test("settings save the daily goal", async ({ page }) => {
    const email = await signUpFreshLearner(page);
    await page.goto("/profile");
    await page.getByLabel(/Serious: 30 XP/).check();
    await page.getByRole("button", { name: "Save settings" }).click();
    await expect(page.getByText("Saved.")).toBeVisible();
    const [user] = await query<{ dailyGoalXp: number }>(`select "dailyGoalXp" from "User" where email = $1`, [email]);
    expect(user.dailyGoalXp).toBe(30);
  });

  test("signed-out visitors see the landing page and can't reach the app", async ({ page }) => {
    await page.goto("/");
    await expect(page.getByRole("heading", { name: "Learn Tagalog five minutes at a time." })).toBeVisible();
    await page.goto("/learn");
    await page.waitForURL("**/login**");
  });
});
