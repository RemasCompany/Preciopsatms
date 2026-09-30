-- AlterTable
ALTER TABLE "Timesheet" ADD COLUMN     "clientApprovedAt" TIMESTAMP(3),
ADD COLUMN     "clientApprovedBy" TEXT,
ADD COLUMN     "clientDisputeNote" TEXT,
ADD COLUMN     "clientDisputedAt" TIMESTAMP(3);

-- CreateTable
CREATE TABLE "ClientPortalLink" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "contactId" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "revokedAt" TIMESTAMP(3),
    "lastUsedAt" TIMESTAMP(3),
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ClientPortalLink_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ClientPortalLink_tokenHash_key" ON "ClientPortalLink"("tokenHash");

-- CreateIndex
CREATE INDEX "ClientPortalLink_organizationId_contactId_idx" ON "ClientPortalLink"("organizationId", "contactId");

-- AddForeignKey
ALTER TABLE "ClientPortalLink" ADD CONSTRAINT "ClientPortalLink_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ClientPortalLink" ADD CONSTRAINT "ClientPortalLink_contactId_fkey" FOREIGN KEY ("contactId") REFERENCES "Contact"("id") ON DELETE CASCADE ON UPDATE CASCADE;
