-- Video training: a per-course watch requirement and per-enrollment watch tracking.
ALTER TABLE "TrainingCourse" ADD COLUMN "minWatchPct" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "TrainingEnrollment" ADD COLUMN "watch" JSONB NOT NULL DEFAULT '{}';
ALTER TABLE "TrainingEnrollment" ADD COLUMN "lastActivityAt" TIMESTAMP(3);
