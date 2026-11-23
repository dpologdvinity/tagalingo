-- CreateEnum
CREATE TYPE "VerbAffix" AS ENUM ('um', 'mag', 'ma', 'mang', 'maka', 'makapag', 'magpa', 'maki', 'in', 'i', 'an', 'ipag', 'ipang', 'pa_in', 'ma_obj');

-- AlterTable
ALTER TABLE "LessonAttempt" ADD COLUMN     "patternId" TEXT,
ADD COLUMN     "weakGrammar" BOOLEAN NOT NULL DEFAULT false;

-- CreateTable
CREATE TABLE "GrammarPattern" (
    "id" TEXT NOT NULL,
    "courseId" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "order" INTEGER NOT NULL,
    "title" TEXT NOT NULL,
    "card" JSONB NOT NULL,
    "lessonId" TEXT NOT NULL,

    CONSTRAINT "GrammarPattern_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ExercisePattern" (
    "exerciseId" TEXT NOT NULL,
    "patternId" TEXT NOT NULL,

    CONSTRAINT "ExercisePattern_pkey" PRIMARY KEY ("exerciseId","patternId")
);

-- CreateTable
CREATE TABLE "PatternProgress" (
    "userId" TEXT NOT NULL,
    "patternId" TEXT NOT NULL,
    "seenAt" TIMESTAMP(3),
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "correct" INTEGER NOT NULL DEFAULT 0,
    "strength" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "lastPracticedAt" TIMESTAMP(3),

    CONSTRAINT "PatternProgress_pkey" PRIMARY KEY ("userId","patternId")
);

-- CreateTable
CREATE TABLE "VerbTable" (
    "id" TEXT NOT NULL,
    "courseId" TEXT NOT NULL,
    "root" TEXT NOT NULL,
    "affix" "VerbAffix" NOT NULL,
    "en" TEXT NOT NULL,
    "forms" JSONB NOT NULL,
    "status" "ExerciseStatus" NOT NULL DEFAULT 'DRAFT',
    "irregular" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "reviewNote" TEXT,
    "reviewedById" TEXT,
    "reviewedAt" TIMESTAMP(3),

    CONSTRAINT "VerbTable_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CardFlag" (
    "id" TEXT NOT NULL,
    "patternId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "note" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "resolvedAt" TIMESTAMP(3),

    CONSTRAINT "CardFlag_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "GrammarPattern_courseId_slug_key" ON "GrammarPattern"("courseId", "slug");

-- CreateIndex
CREATE INDEX "ExercisePattern_patternId_idx" ON "ExercisePattern"("patternId");

-- CreateIndex
CREATE INDEX "PatternProgress_patternId_idx" ON "PatternProgress"("patternId");

-- CreateIndex
CREATE UNIQUE INDEX "VerbTable_courseId_root_affix_key" ON "VerbTable"("courseId", "root", "affix");

-- AddForeignKey
ALTER TABLE "LessonAttempt" ADD CONSTRAINT "LessonAttempt_patternId_fkey" FOREIGN KEY ("patternId") REFERENCES "GrammarPattern"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GrammarPattern" ADD CONSTRAINT "GrammarPattern_courseId_fkey" FOREIGN KEY ("courseId") REFERENCES "Course"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GrammarPattern" ADD CONSTRAINT "GrammarPattern_lessonId_fkey" FOREIGN KEY ("lessonId") REFERENCES "Lesson"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ExercisePattern" ADD CONSTRAINT "ExercisePattern_exerciseId_fkey" FOREIGN KEY ("exerciseId") REFERENCES "Exercise"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ExercisePattern" ADD CONSTRAINT "ExercisePattern_patternId_fkey" FOREIGN KEY ("patternId") REFERENCES "GrammarPattern"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PatternProgress" ADD CONSTRAINT "PatternProgress_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PatternProgress" ADD CONSTRAINT "PatternProgress_patternId_fkey" FOREIGN KEY ("patternId") REFERENCES "GrammarPattern"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VerbTable" ADD CONSTRAINT "VerbTable_courseId_fkey" FOREIGN KEY ("courseId") REFERENCES "Course"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VerbTable" ADD CONSTRAINT "VerbTable_reviewedById_fkey" FOREIGN KEY ("reviewedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CardFlag" ADD CONSTRAINT "CardFlag_patternId_fkey" FOREIGN KEY ("patternId") REFERENCES "GrammarPattern"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CardFlag" ADD CONSTRAINT "CardFlag_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

