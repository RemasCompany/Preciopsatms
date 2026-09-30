-- AlterTable
ALTER TABLE "Organization" ADD COLUMN     "everifyEnabled" BOOLEAN NOT NULL DEFAULT false;

-- CreateTable
CREATE TABLE "EVerifyCase" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "candidateId" TEXT NOT NULL,
    "applicationId" TEXT,
    "startDate" DATE NOT NULL,
    "dueDate" DATE NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'to_create',
    "caseNumber" TEXT,
    "notes" TEXT,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "closedAt" TIMESTAMP(3),

    CONSTRAINT "EVerifyCase_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "EVerifyCase_organizationId_status_dueDate_idx" ON "EVerifyCase"("organizationId", "status", "dueDate");

-- CreateIndex
CREATE INDEX "EVerifyCase_organizationId_candidateId_idx" ON "EVerifyCase"("organizationId", "candidateId");

-- AddForeignKey
ALTER TABLE "EVerifyCase" ADD CONSTRAINT "EVerifyCase_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EVerifyCase" ADD CONSTRAINT "EVerifyCase_candidateId_fkey" FOREIGN KEY ("candidateId") REFERENCES "Candidate"("id") ON DELETE CASCADE ON UPDATE CASCADE;
