-- AlterTable
ALTER TABLE "Job" ADD COLUMN     "postalCode" TEXT,
ADD COLUMN     "remote" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "Organization" ADD COLUMN     "indeedApplyApiToken" TEXT,
ADD COLUMN     "indeedApplySecret" TEXT;
