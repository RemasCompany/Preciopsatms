-- CreateTable
CREATE TABLE "Credential" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "candidateId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "name" TEXT,
    "number" TEXT,
    "state" TEXT,
    "issuedAt" DATE,
    "expiresAt" DATE,
    "verifiedAt" TIMESTAMP(3),
    "verifiedById" TEXT,
    "verifyMethod" TEXT,
    "verifyNote" TEXT,
    "fileId" TEXT,
    "alertedLevel" INTEGER,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Credential_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Credential_organizationId_expiresAt_idx" ON "Credential"("organizationId", "expiresAt");

-- CreateIndex
CREATE INDEX "Credential_candidateId_idx" ON "Credential"("candidateId");

-- AddForeignKey
ALTER TABLE "Credential" ADD CONSTRAINT "Credential_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Credential" ADD CONSTRAINT "Credential_candidateId_fkey" FOREIGN KEY ("candidateId") REFERENCES "Candidate"("id") ON DELETE CASCADE ON UPDATE CASCADE;
