-- CreateTable
CREATE TABLE "HiringDocument" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "candidateId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "sensitive" BOOLEAN NOT NULL DEFAULT false,
    "status" TEXT NOT NULL DEFAULT 'REQUESTED',
    "files" JSONB NOT NULL DEFAULT '[]',
    "note" TEXT,
    "requestedById" TEXT,
    "signDocumentId" TEXT,
    "onboardingStepId" TEXT,
    "receivedAt" TIMESTAMP(3),
    "reviewedAt" TIMESTAMP(3),
    "reviewedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "HiringDocument_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "HiringDocument_organizationId_candidateId_idx" ON "HiringDocument"("organizationId", "candidateId");

-- CreateIndex
CREATE INDEX "HiringDocument_onboardingStepId_idx" ON "HiringDocument"("onboardingStepId");

-- AddForeignKey
ALTER TABLE "HiringDocument" ADD CONSTRAINT "HiringDocument_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "HiringDocument" ADD CONSTRAINT "HiringDocument_candidateId_fkey" FOREIGN KEY ("candidateId") REFERENCES "Candidate"("id") ON DELETE CASCADE ON UPDATE CASCADE;

