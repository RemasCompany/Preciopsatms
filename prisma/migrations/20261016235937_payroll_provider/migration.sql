-- AlterTable
ALTER TABLE "PayrollRun" ADD COLUMN     "providerError" TEXT,
ADD COLUMN     "providerPayrollId" TEXT,
ADD COLUMN     "providerSentAt" TIMESTAMP(3),
ADD COLUMN     "providerStatus" TEXT,
ADD COLUMN     "providerTotals" JSONB;

-- CreateTable
CREATE TABLE "PayrollConnection" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "companyName" TEXT,
    "workplaceId" TEXT NOT NULL,
    "onboardStatus" TEXT NOT NULL DEFAULT 'blocking',
    "connectedById" TEXT,
    "connectedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "checkedAt" TIMESTAMP(3),
    "lastError" TEXT,

    CONSTRAINT "PayrollConnection_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PayrollWorker" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "candidateId" TEXT NOT NULL,
    "externalId" TEXT NOT NULL,
    "onboardStatus" TEXT NOT NULL DEFAULT 'blocking',
    "missing" TEXT[],
    "checkedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PayrollWorker_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "PayrollConnection_provider_companyId_idx" ON "PayrollConnection"("provider", "companyId");

-- CreateIndex
CREATE UNIQUE INDEX "PayrollConnection_organizationId_provider_key" ON "PayrollConnection"("organizationId", "provider");

-- CreateIndex
CREATE UNIQUE INDEX "PayrollWorker_organizationId_provider_candidateId_key" ON "PayrollWorker"("organizationId", "provider", "candidateId");

-- AddForeignKey
ALTER TABLE "PayrollConnection" ADD CONSTRAINT "PayrollConnection_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PayrollWorker" ADD CONSTRAINT "PayrollWorker_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

