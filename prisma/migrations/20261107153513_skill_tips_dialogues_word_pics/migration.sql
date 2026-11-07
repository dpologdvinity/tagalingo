-- AlterTable
ALTER TABLE "Skill" ADD COLUMN     "dialogues" JSONB NOT NULL DEFAULT '[]',
ADD COLUMN     "tips" TEXT[] DEFAULT ARRAY[]::TEXT[];

-- AlterTable
ALTER TABLE "Word" ADD COLUMN     "pic" TEXT;
