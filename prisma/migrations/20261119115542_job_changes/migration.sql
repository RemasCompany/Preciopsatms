-- AlterTable
ALTER TABLE "Organization" ADD COLUMN     "jobChangeApproval" BOOLEAN NOT NULL DEFAULT true;

-- CreateTable
CREATE TABLE "JobChange" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "employeeId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "effectiveDate" DATE NOT NULL,
    "reason" TEXT NOT NULL,
    "fromTitle" TEXT NOT NULL,
    "toTitle" TEXT,
    "fromDepartmentId" TEXT,
    "toDepartmentId" TEXT,
    "fromManagerId" TEXT,
    "toManagerId" TEXT,
    "fromBranchId" TEXT,
    "toBranchId" TEXT,
    "fromPayType" "PayType" NOT NULL,
    "fromPayRate" DECIMAL(12,2) NOT NULL,
    "toPayType" "PayType",
    "toPayRate" DECIMAL(12,2),
    "notifyEmployee" BOOLEAN NOT NULL DEFAULT true,
    "requestedById" TEXT,
    "requestedByName" TEXT,
    "decidedById" TEXT,
    "decidedByName" TEXT,
    "decidedAt" TIMESTAMP(3),
    "decisionNote" TEXT,
    "appliedAt" TIMESTAMP(3),
    "employeeNotifiedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "JobChange_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "JobChange_organizationId_status_idx" ON "JobChange"("organizationId", "status");

-- CreateIndex
CREATE INDEX "JobChange_employeeId_createdAt_idx" ON "JobChange"("employeeId", "createdAt");

-- AddForeignKey
ALTER TABLE "JobChange" ADD CONSTRAINT "JobChange_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "JobChange" ADD CONSTRAINT "JobChange_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "Employee"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "JobChange" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "JobChange" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "JobChange" USING (coalesce(current_setting('app.org_id', true), '') = '' OR "organizationId" = current_setting('app.org_id', true)) WITH CHECK (coalesce(current_setting('app.org_id', true), '') = '' OR "organizationId" = current_setting('app.org_id', true));
