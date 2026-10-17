-- AlterEnum
ALTER TYPE "PayrollAdjustmentKind" ADD VALUE 'PRETAX_DEDUCTION';

-- AlterTable
ALTER TABLE "Organization" ADD COLUMN     "payrollExportDeductions" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "PayrollAdjustment" ADD COLUMN     "code" TEXT,
ADD COLUMN     "deductionId" TEXT;

-- CreateTable
CREATE TABLE "PayDeduction" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "candidateId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "pretax" BOOLEAN NOT NULL,
    "amountType" TEXT NOT NULL,
    "amount" DECIMAL(10,2) NOT NULL,
    "annualLimit" DECIMAL(10,2),
    "employerAmount" DECIMAL(10,2),
    "startDate" DATE NOT NULL,
    "endDate" DATE,
    "providerId" TEXT,
    "providerSyncedAt" TIMESTAMP(3),
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PayDeduction_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "PayDeduction_organizationId_candidateId_idx" ON "PayDeduction"("organizationId", "candidateId");

-- AddForeignKey
ALTER TABLE "PayDeduction" ADD CONSTRAINT "PayDeduction_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PayDeduction" ADD CONSTRAINT "PayDeduction_candidateId_fkey" FOREIGN KEY ("candidateId") REFERENCES "Candidate"("id") ON DELETE CASCADE ON UPDATE CASCADE;


-- Row-level security (see 20…_row_level_security)
ALTER TABLE "PayDeduction" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "PayDeduction" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "PayDeduction" USING (coalesce(current_setting('app.org_id', true), '') = '' OR "organizationId" = current_setting('app.org_id', true)) WITH CHECK (coalesce(current_setting('app.org_id', true), '') = '' OR "organizationId" = current_setting('app.org_id', true));
