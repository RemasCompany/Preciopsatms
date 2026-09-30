-- CreateTable
CREATE TABLE "DoNotReturn" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "candidateId" TEXT NOT NULL,
    "clientId" TEXT,
    "reason" TEXT NOT NULL,
    "source" TEXT NOT NULL DEFAULT 'staff',
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "liftedAt" TIMESTAMP(3),
    "liftedById" TEXT,
    "liftReason" TEXT,

    CONSTRAINT "DoNotReturn_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "DoNotReturn_organizationId_candidateId_idx" ON "DoNotReturn"("organizationId", "candidateId");

-- AddForeignKey
ALTER TABLE "DoNotReturn" ADD CONSTRAINT "DoNotReturn_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DoNotReturn" ADD CONSTRAINT "DoNotReturn_candidateId_fkey" FOREIGN KEY ("candidateId") REFERENCES "Candidate"("id") ON DELETE CASCADE ON UPDATE CASCADE;
