-- AlterTable
ALTER TABLE "Organization" ADD COLUMN     "referralBonus" DECIMAL(10,2),
ADD COLUMN     "referralMinHours" INTEGER NOT NULL DEFAULT 80;

-- CreateTable
CREATE TABLE "Referral" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "referrerId" TEXT NOT NULL,
    "candidateId" TEXT NOT NULL,
    "jobId" TEXT,
    "note" TEXT,
    "status" TEXT NOT NULL DEFAULT 'submitted',
    "bonus" DECIMAL(10,2),
    "minHours" INTEGER,
    "paidAt" TIMESTAMP(3),
    "paidById" TEXT,
    "ineligibleReason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Referral_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Referral_organizationId_referrerId_idx" ON "Referral"("organizationId", "referrerId");

-- CreateIndex
CREATE UNIQUE INDEX "Referral_organizationId_candidateId_key" ON "Referral"("organizationId", "candidateId");

-- AddForeignKey
ALTER TABLE "Referral" ADD CONSTRAINT "Referral_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
