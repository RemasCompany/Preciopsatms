-- AlterTable
ALTER TABLE "Task" ADD COLUMN     "followedUpAt" TIMESTAMP(3),
ADD COLUMN     "remindedAt" TIMESTAMP(3);

-- CreateTable
CREATE TABLE "Announcement" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "branchId" TEXT,
    "createdById" TEXT,
    "emailed" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Announcement_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ShiftChangeRequest" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "shiftId" TEXT NOT NULL,
    "candidateId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "note" TEXT,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "reply" TEXT,
    "decidedById" TEXT,
    "decidedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ShiftChangeRequest_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ApiKey" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "prefix" TEXT NOT NULL,
    "keyHash" TEXT NOT NULL,
    "createdById" TEXT,
    "lastUsedAt" TIMESTAMP(3),
    "revokedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ApiKey_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Announcement_organizationId_createdAt_idx" ON "Announcement"("organizationId", "createdAt");

-- CreateIndex
CREATE INDEX "ShiftChangeRequest_organizationId_status_idx" ON "ShiftChangeRequest"("organizationId", "status");

-- CreateIndex
CREATE INDEX "ShiftChangeRequest_shiftId_idx" ON "ShiftChangeRequest"("shiftId");

-- CreateIndex
CREATE UNIQUE INDEX "ApiKey_keyHash_key" ON "ApiKey"("keyHash");

-- CreateIndex
CREATE INDEX "ApiKey_organizationId_idx" ON "ApiKey"("organizationId");

-- AddForeignKey
ALTER TABLE "Announcement" ADD CONSTRAINT "Announcement_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Announcement" ADD CONSTRAINT "Announcement_branchId_fkey" FOREIGN KEY ("branchId") REFERENCES "Branch"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ShiftChangeRequest" ADD CONSTRAINT "ShiftChangeRequest_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ShiftChangeRequest" ADD CONSTRAINT "ShiftChangeRequest_shiftId_fkey" FOREIGN KEY ("shiftId") REFERENCES "Shift"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ApiKey" ADD CONSTRAINT "ApiKey_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "Announcement" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "Announcement" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "Announcement" USING (coalesce(current_setting('app.org_id', true), '') = '' OR "organizationId" = current_setting('app.org_id', true)) WITH CHECK (coalesce(current_setting('app.org_id', true), '') = '' OR "organizationId" = current_setting('app.org_id', true));

ALTER TABLE "ShiftChangeRequest" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "ShiftChangeRequest" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "ShiftChangeRequest" USING (coalesce(current_setting('app.org_id', true), '') = '' OR "organizationId" = current_setting('app.org_id', true)) WITH CHECK (coalesce(current_setting('app.org_id', true), '') = '' OR "organizationId" = current_setting('app.org_id', true));

ALTER TABLE "ApiKey" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "ApiKey" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "ApiKey" USING (coalesce(current_setting('app.org_id', true), '') = '' OR "organizationId" = current_setting('app.org_id', true)) WITH CHECK (coalesce(current_setting('app.org_id', true), '') = '' OR "organizationId" = current_setting('app.org_id', true));
