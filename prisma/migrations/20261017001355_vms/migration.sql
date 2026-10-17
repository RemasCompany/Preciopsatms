-- AlterTable
ALTER TABLE "Application" ADD COLUMN     "vmsWorkOrderId" TEXT,
ADD COLUMN     "vmsWorkerId" TEXT;

-- AlterTable
ALTER TABLE "Job" ADD COLUMN     "vmsProgramId" TEXT,
ADD COLUMN     "vmsReqId" TEXT;

-- AlterTable
ALTER TABLE "Timesheet" ADD COLUMN     "vmsExportedAt" TIMESTAMP(3);

-- CreateTable
CREATE TABLE "VmsProgram" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "vms" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "supplierCode" TEXT,
    "feePct" DECIMAL(5,2) NOT NULL DEFAULT 0,
    "mappings" JSONB,
    "rateCodes" JSONB,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastImportAt" TIMESTAMP(3),

    CONSTRAINT "VmsProgram_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "VmsProgram_organizationId_clientId_idx" ON "VmsProgram"("organizationId", "clientId");

-- CreateIndex
CREATE UNIQUE INDEX "Job_organizationId_vmsProgramId_vmsReqId_key" ON "Job"("organizationId", "vmsProgramId", "vmsReqId");

-- AddForeignKey
ALTER TABLE "Job" ADD CONSTRAINT "Job_vmsProgramId_fkey" FOREIGN KEY ("vmsProgramId") REFERENCES "VmsProgram"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VmsProgram" ADD CONSTRAINT "VmsProgram_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VmsProgram" ADD CONSTRAINT "VmsProgram_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "Client"("id") ON DELETE CASCADE ON UPDATE CASCADE;

