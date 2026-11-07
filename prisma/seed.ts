/**
 * Seeds a fresh, realistic Tagalingo database. Safe to re-run: it wipes and rebuilds.
 *
 *  1. Course structure + word lists from content/tagalog/course.yaml.
 *  2. Reviewed exercises from content/tagalog/exercises/*.json (status APPROVED).
 *     Skills without a reviewed file get stub-generated DRAFTs, waiting in /studio.
 *  3. A demo account (also a reviewer) with a 7-day streak and partial progress, plus 24
 *     other learners so the weekly leaderboard looks alive.
 *
 * Demo login: demo@tagalingo.app / tagalingo-demo
 */
import "dotenv/config";
import bcrypt from "bcryptjs";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../src/generated/prisma/client";
import { loadCourseFile } from "../src/lib/content/course";
import { StubGenerator } from "../src/lib/content/generators/stub";
import { generateDraftsForLesson, importApprovedExercises, syncCourseStructure } from "../src/lib/content/persist";
import { COURSE_FILE, CONTENT_DIR } from "../src/lib/content/paths";
import { LOCAL_DATABASE_URL } from "../src/lib/env-defaults";
import { weekStartUtc } from "../src/lib/game/league";
import { addDays, dayKey } from "../src/lib/game/streak";
import { hash, rng } from "../src/lib/random";
import { DEMO_ACCOUNT } from "../src/lib/demo";

const { email: DEMO_EMAIL, password: DEMO_PASSWORD } = DEMO_ACCOUNT;

const prisma = new PrismaClient({
  adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL || LOCAL_DATABASE_URL }),
});
const rand = rng(hash("tagalingo-seed"));
const between = (lo: number, hi: number) => lo + Math.floor(rand() * (hi - lo + 1));
const DAY = 86_400_000;

const RIVALS = [
  "Marisol Reyes", "Paolo Santos", "Jasmine Cruz", "Miguel Bautista", "Liza Garcia", "Kenji Tanaka",
  "Bea Villanueva", "Carlo Mendoza", "Anika Patel", "Rafael Dizon", "Hannah Lim", "Joaquin Ramos",
  "Sofia Navarro", "Tomás Herrera", "Grace Ocampo", "Daniel Kim", "Isabel Aquino", "Noah Fischer",
  "Camille Torres", "Luis Fernandez", "Mei Chen", "Andrés Castillo", "Patricia Flores", "Ethan Walker",
];

async function wipe() {
  // Children before parents.
  await prisma.attemptAnswer.deleteMany();
  await prisma.lessonAttempt.deleteMany();
  await prisma.lessonProgress.deleteMany();
  await prisma.xpEvent.deleteMany();
  await prisma.dailyActivity.deleteMany();
  await prisma.exercise.deleteMany();
  await prisma.generationRun.deleteMany();
  await prisma.word.deleteMany();
  await prisma.lesson.deleteMany();
  await prisma.skill.deleteMany();
  await prisma.unit.deleteMany();
  await prisma.course.deleteMany();
  await prisma.user.deleteMany();
}

/** An instant that falls on the local calendar day `daysAgo` days before now. */
function instantDaysAgo(now: Date, daysAgo: number, minutesEarlier = 1) {
  return new Date(now.getTime() - daysAgo * DAY - minutesEarlier * 60_000);
}

async function seedDemoLearner(now: Date, timezone: string) {
  const passwordHash = await bcrypt.hash(DEMO_PASSWORD, 10);
  const demo = await prisma.user.create({
    data: {
      email: DEMO_EMAIL,
      name: "Demo Learner",
      passwordHash,
      isReviewer: true,
      timezone,
      dailyGoalXp: 20,
      hearts: 4,
      heartsUpdatedAt: new Date(now.getTime() - 12 * 60_000), // next heart in ~18 min
      avatarHue: 175,
      createdAt: new Date(now.getTime() - 60 * DAY), // history below goes back 41 days
    },
  });

  // Finished: the first three skills and the first lesson of the fourth.
  const skills = await prisma.skill.findMany({
    orderBy: [{ unit: { order: "asc" } }, { order: "asc" }],
    include: { lessons: { orderBy: { order: "asc" } } },
  });
  const finished = [...skills.slice(0, 3).flatMap((s) => s.lessons), ...(skills[3]?.lessons.slice(0, 1) ?? [])];

  // Activity history: a current 7-day streak (incl. today), a gap, an older 12-day streak, scattered days.
  const activeDays = [
    ...Array.from({ length: 7 }, (_, i) => i),
    ...Array.from({ length: 12 }, (_, i) => 8 + i),
    25, 27, 30, 33, 41,
  ];
  let totalXp = 0;
  for (const daysAgo of activeDays) {
    const xp = daysAgo === 0 ? 15 : between(1, 4) * 10 + (rand() < 0.4 ? 5 : 0);
    const day = dayKey(instantDaysAgo(now, daysAgo), timezone);
    const when = instantDaysAgo(now, daysAgo, daysAgo === 0 ? 1 : between(1, 600));
    // Keep "when" on the intended local day.
    const createdAt = dayKey(when, timezone) === day ? when : instantDaysAgo(now, daysAgo);
    await prisma.xpEvent.create({ data: { userId: demo.id, amount: xp, reason: "lesson", createdAt } });
    await prisma.dailyActivity.create({ data: { userId: demo.id, day, xp, lessons: Math.max(1, Math.round(xp / 15)) } });
    totalXp += xp;
  }
  const finishedAt = (i: number) => instantDaysAgo(now, 30 - i * 4);
  await prisma.lessonProgress.createMany({
    data: finished.map((l, i) => ({ userId: demo.id, lessonId: l.id, firstCompletedAt: finishedAt(i), timesCompleted: 1 + (i % 3) })),
  });
  await prisma.lessonAttempt.createMany({
    data: finished.map((l, i) => ({
      userId: demo.id,
      lessonId: l.id,
      status: "COMPLETED" as const,
      startedAt: new Date(finishedAt(i).getTime() - 4 * 60_000),
      completedAt: finishedAt(i),
      mistakes: i % 3,
      xpAwarded: 15,
    })),
  });
  await prisma.user.update({
    where: { id: demo.id },
    data: { totalXp, currentStreak: 7, longestStreak: 12, lastStreakDay: dayKey(now, timezone) },
  });
  return demo;
}

async function seedRivals(now: Date) {
  const weekStart = weekStartUtc(now).getTime();
  const passwordHash = await bcrypt.hash(`rival-${hash(String(now.getTime()))}`, 4); // never used to log in
  for (const [i, name] of RIVALS.entries()) {
    const user = await prisma.user.create({
      data: {
        email: `${name.toLowerCase().normalize("NFD").replace(/[^a-z ]/g, "").replace(/ /g, ".")}@example.com`,
        name,
        passwordHash,
        avatarHue: (i * 47) % 360,
        dailyGoalXp: [10, 20, 30, 50][i % 4],
        timezone: "Asia/Manila",
        createdAt: new Date(now.getTime() - between(20, 400) * DAY),
      },
    });
    // Weekly XP between ~10 and ~420, skewed so a few people lead.
    const sessions = Math.max(1, Math.round(Math.pow(rand(), 1.6) * 22));
    let total = 0;
    const events = Array.from({ length: sessions }, () => {
      const amount = [10, 15, 15, 20, 20][between(0, 4)];
      total += amount;
      return { userId: user.id, amount, reason: "lesson", createdAt: new Date(between(weekStart, now.getTime() - 60_000)) };
    });
    // Some history from earlier weeks so lifetime XP is larger than weekly XP.
    const history = between(200, 3000);
    events.push({ userId: user.id, amount: history, reason: "history", createdAt: new Date(weekStart - between(2, 60) * DAY) });
    await prisma.xpEvent.createMany({ data: events });
    const streak = between(0, 45);
    await prisma.user.update({
      where: { id: user.id },
      data: {
        totalXp: total + history,
        currentStreak: streak,
        longestStreak: streak + between(0, 30),
        lastStreakDay: streak ? addDays(dayKey(now, "Asia/Manila"), -between(0, 1)) : null,
      },
    });
  }
}

async function main() {
  const now = new Date();
  const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
  const course = loadCourseFile(COURSE_FILE);

  await wipe();
  await syncCourseStructure(prisma, course);

  const demo = await seedDemoLearner(now, timezone);
  const reviewed = await importApprovedExercises(prisma, CONTENT_DIR, demo.id);

  // Anything without reviewed content starts life as stub drafts in the Studio review queue.
  const stub = new StubGenerator();
  let drafts = 0;
  for (const skill of course.units.flatMap((u) => u.skills)) {
    if (reviewed.has(skill.slug)) continue;
    for (let order = 1; order <= skill.lessons.length; order++) {
      drafts += (await generateDraftsForLesson(prisma, stub, course, { skillSlug: skill.slug, lessonOrder: order })).created;
    }
  }

  await seedRivals(now);

  const approved = await prisma.exercise.count({ where: { status: "APPROVED" } });
  console.log(`Seeded: ${approved} approved exercises (${reviewed.size} skills), ${drafts} drafts awaiting review.`);
  console.log(`Demo login: ${DEMO_EMAIL} / ${DEMO_PASSWORD}`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
