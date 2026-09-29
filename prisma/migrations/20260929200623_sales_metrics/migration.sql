-- AlterTable
ALTER TABLE "Deal" ADD COLUMN     "closedAt" TIMESTAMP(3),
ADD COLUMN     "ownerId" TEXT,
ADD COLUMN     "stageChangedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;

-- AlterTable
ALTER TABLE "Lead" ADD COLUMN     "convertedAt" TIMESTAMP(3),
ADD COLUMN     "ownerId" TEXT;

-- CreateTable
CREATE TABLE "SalesTarget" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "month" DATE NOT NULL,
    "amount" DECIMAL(12,2) NOT NULL,

    CONSTRAINT "SalesTarget_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "SalesTarget_organizationId_userId_month_key" ON "SalesTarget"("organizationId", "userId", "month");

-- AddForeignKey
ALTER TABLE "SalesTarget" ADD CONSTRAINT "SalesTarget_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Backfill: deals already closed get a close date from their last update; leads already converted likewise.
UPDATE "Deal" SET "closedAt" = "updatedAt", "stageChangedAt" = "updatedAt" WHERE "stage" IN ('Won', 'Lost') AND "closedAt" IS NULL;
UPDATE "Lead" SET "convertedAt" = "updatedAt" WHERE "status" = 'Converted' AND "convertedAt" IS NULL;
