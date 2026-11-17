-- AlterTable
ALTER TABLE "Organization" ADD COLUMN     "complimentaryBy" TEXT,
ADD COLUMN     "trialNotice" INTEGER NOT NULL DEFAULT -1;

-- Companies already marked free came from the complimentary list.
UPDATE "Organization" SET "complimentaryBy" = 'list' WHERE "complimentary" = true AND "complimentaryBy" IS NULL;
