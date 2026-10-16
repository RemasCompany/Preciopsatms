-- AlterTable
ALTER TABLE "Employee" ADD COLUMN     "reviewFrequency" TEXT;

-- AlterTable
ALTER TABLE "Organization" ADD COLUMN     "reviewBasis" TEXT NOT NULL DEFAULT 'HIRE_DATE',
ADD COLUMN     "reviewFrequency" TEXT NOT NULL DEFAULT 'ANNUAL',
ADD COLUMN     "reviewLeadDays" INTEGER NOT NULL DEFAULT 30,
ADD COLUMN     "reviewMonth" INTEGER NOT NULL DEFAULT 1,
ADD COLUMN     "reviewScheduleOn" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "Review" ADD COLUMN     "dueDate" DATE,
ADD COLUMN     "lastRemindedAt" TIMESTAMP(3),
ADD COLUMN     "reminderStage" INTEGER NOT NULL DEFAULT -1;

-- AlterTable
ALTER TABLE "ReviewCycle" ADD COLUMN     "auto" TEXT;

