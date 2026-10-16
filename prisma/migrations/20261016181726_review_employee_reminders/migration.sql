-- AlterTable
ALTER TABLE "Organization" ADD COLUMN     "reviewRemindEmployees" BOOLEAN NOT NULL DEFAULT true;

-- AlterTable
ALTER TABLE "Review" ADD COLUMN     "ackReminderStage" INTEGER NOT NULL DEFAULT -1,
ADD COLUMN     "selfReminderStage" INTEGER NOT NULL DEFAULT -1;

