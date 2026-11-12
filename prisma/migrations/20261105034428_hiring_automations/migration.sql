-- AlterTable
ALTER TABLE "Job" ADD COLUMN     "managerId" TEXT;

-- AlterTable
ALTER TABLE "Organization" ADD COLUMN     "automation" JSONB NOT NULL DEFAULT '{}';
