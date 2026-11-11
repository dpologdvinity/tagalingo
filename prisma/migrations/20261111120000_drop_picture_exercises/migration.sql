-- Drop the "Which picture shows this?" exercise type: emoji pictures are open to more than one
-- reading, so they can't be graded fairly.

-- Forget picture exercises in attempt snapshots, so lessons in progress can still be completed.
UPDATE "LessonAttempt" a
SET "exerciseIds" = ARRAY(
  SELECT u.id
  FROM unnest(a."exerciseIds") WITH ORDINALITY AS u(id, n)
  WHERE u.id NOT IN (SELECT e.id FROM "Exercise" e WHERE e."type" = 'select_picture')
  ORDER BY u.n
)
WHERE a."exerciseIds" && ARRAY(SELECT e.id FROM "Exercise" e WHERE e."type" = 'select_picture');

-- Their recorded answers go with them (AttemptAnswer cascades on delete).
DELETE FROM "Exercise" WHERE "type" = 'select_picture';

-- AlterEnum
BEGIN;
CREATE TYPE "ExerciseType_new" AS ENUM ('select_translation', 'word_bank', 'match_pairs', 'fill_blank', 'type_translation', 'listen_select', 'speak', 'dialogue');
ALTER TABLE "Exercise" ALTER COLUMN "type" TYPE "ExerciseType_new" USING ("type"::text::"ExerciseType_new");
ALTER TYPE "ExerciseType" RENAME TO "ExerciseType_old";
ALTER TYPE "ExerciseType_new" RENAME TO "ExerciseType";
DROP TYPE "public"."ExerciseType_old";
COMMIT;
