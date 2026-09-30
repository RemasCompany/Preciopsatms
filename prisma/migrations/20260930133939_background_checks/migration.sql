-- CreateTable
CREATE TABLE "BackgroundCheck" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "candidateId" TEXT NOT NULL,
    "provider" TEXT NOT NULL DEFAULT 'checkr',
    "package" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'invited',
    "externalCandidateId" TEXT,
    "externalInvitationId" TEXT,
    "externalReportId" TEXT,
    "invitationUrl" TEXT,
    "orderedById" TEXT,
    "orderedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completedAt" TIMESTAMP(3),
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "BackgroundCheck_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "BackgroundCheck_externalReportId_key" ON "BackgroundCheck"("externalReportId");

-- CreateIndex
CREATE INDEX "BackgroundCheck_organizationId_candidateId_idx" ON "BackgroundCheck"("organizationId", "candidateId");

-- CreateIndex
CREATE INDEX "BackgroundCheck_externalInvitationId_idx" ON "BackgroundCheck"("externalInvitationId");

-- AddForeignKey
ALTER TABLE "BackgroundCheck" ADD CONSTRAINT "BackgroundCheck_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BackgroundCheck" ADD CONSTRAINT "BackgroundCheck_candidateId_fkey" FOREIGN KEY ("candidateId") REFERENCES "Candidate"("id") ON DELETE CASCADE ON UPDATE CASCADE;
