-- CreateEnum
CREATE TYPE "AttemptKind" AS ENUM ('LESSON', 'PRACTICE');

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "ExerciseType" ADD VALUE 'listen_select';
ALTER TYPE "ExerciseType" ADD VALUE 'select_picture';
ALTER TYPE "ExerciseType" ADD VALUE 'speak';
ALTER TYPE "ExerciseType" ADD VALUE 'dialogue';

-- AlterTable
ALTER TABLE "LessonAttempt" ADD COLUMN     "exerciseIds" TEXT[] DEFAULT ARRAY[]::TEXT[],
ADD COLUMN     "kind" "AttemptKind" NOT NULL DEFAULT 'LESSON',
ADD COLUMN     "skillId" TEXT,
ADD COLUMN     "unitId" TEXT,
ALTER COLUMN "lessonId" DROP NOT NULL;

-- AddForeignKey
ALTER TABLE "LessonAttempt" ADD CONSTRAINT "LessonAttempt_skillId_fkey" FOREIGN KEY ("skillId") REFERENCES "Skill"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LessonAttempt" ADD CONSTRAINT "LessonAttempt_unitId_fkey" FOREIGN KEY ("unitId") REFERENCES "Unit"("id") ON DELETE CASCADE ON UPDATE CASCADE;
