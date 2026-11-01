-- AlterTable
ALTER TABLE "Organization" ADD COLUMN     "exclusionListDate" TEXT,
ADD COLUMN     "exclusionScreenedAt" TIMESTAMP(3),
ADD COLUMN     "exclusionScreening" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "PayrollItem" ADD COLUMN     "premiumBill" DECIMAL(12,2) NOT NULL DEFAULT 0,
ADD COLUMN     "premiumPay" DECIMAL(12,2) NOT NULL DEFAULT 0,
ADD COLUMN     "premiums" JSONB;

-- CreateTable
CREATE TABLE "ExclusionMatch" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "candidateId" TEXT NOT NULL,
    "source" TEXT NOT NULL DEFAULT 'OIG',
    "listKey" TEXT NOT NULL,
    "listedName" TEXT NOT NULL,
    "listedNpi" TEXT,
    "listedDob" TEXT,
    "listedPlace" TEXT,
    "specialty" TEXT,
    "exclType" TEXT,
    "exclDate" TEXT,
    "matchedOn" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'OPEN',
    "reviewedById" TEXT,
    "reviewedAt" TIMESTAMP(3),
    "reviewNote" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ExclusionMatch_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SkillsChecklist" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "candidateId" TEXT NOT NULL,
    "specialty" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'SENT',
    "answers" JSONB,
    "signedName" TEXT,
    "completedAt" TIMESTAMP(3),
    "expiresAt" DATE,
    "sentById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SkillsChecklist_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PayRule" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "mode" TEXT NOT NULL,
    "pay" DECIMAL(10,4) NOT NULL,
    "bill" DECIMAL(10,4) NOT NULL,
    "clientId" TEXT,
    "jobId" TEXT,
    "startTime" TEXT,
    "endTime" TEXT,
    "holidays" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PayRule_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TimesheetPremium" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "timesheetId" TEXT NOT NULL,
    "ruleId" TEXT,
    "label" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "mode" TEXT NOT NULL,
    "hours" DECIMAL(6,2) NOT NULL,
    "payPerHour" DECIMAL(10,2) NOT NULL,
    "billPerHour" DECIMAL(10,2) NOT NULL,
    "inRegularRate" BOOLEAN NOT NULL DEFAULT true,
    "auto" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TimesheetPremium_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ExclusionMatch_organizationId_status_idx" ON "ExclusionMatch"("organizationId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "ExclusionMatch_organizationId_candidateId_listKey_key" ON "ExclusionMatch"("organizationId", "candidateId", "listKey");

-- CreateIndex
CREATE INDEX "SkillsChecklist_organizationId_candidateId_idx" ON "SkillsChecklist"("organizationId", "candidateId");

-- CreateIndex
CREATE INDEX "PayRule_organizationId_idx" ON "PayRule"("organizationId");

-- CreateIndex
CREATE INDEX "TimesheetPremium_timesheetId_idx" ON "TimesheetPremium"("timesheetId");

-- CreateIndex
CREATE INDEX "TimesheetPremium_organizationId_idx" ON "TimesheetPremium"("organizationId");

-- AddForeignKey
ALTER TABLE "ExclusionMatch" ADD CONSTRAINT "ExclusionMatch_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ExclusionMatch" ADD CONSTRAINT "ExclusionMatch_candidateId_fkey" FOREIGN KEY ("candidateId") REFERENCES "Candidate"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SkillsChecklist" ADD CONSTRAINT "SkillsChecklist_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SkillsChecklist" ADD CONSTRAINT "SkillsChecklist_candidateId_fkey" FOREIGN KEY ("candidateId") REFERENCES "Candidate"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PayRule" ADD CONSTRAINT "PayRule_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PayRule" ADD CONSTRAINT "PayRule_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "Client"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PayRule" ADD CONSTRAINT "PayRule_jobId_fkey" FOREIGN KEY ("jobId") REFERENCES "Job"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TimesheetPremium" ADD CONSTRAINT "TimesheetPremium_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TimesheetPremium" ADD CONSTRAINT "TimesheetPremium_timesheetId_fkey" FOREIGN KEY ("timesheetId") REFERENCES "Timesheet"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Row-level security (see 20…_row_level_security)
ALTER TABLE "ExclusionMatch" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "ExclusionMatch" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "ExclusionMatch" USING (coalesce(current_setting('app.org_id', true), '') = '' OR "organizationId" = current_setting('app.org_id', true)) WITH CHECK (coalesce(current_setting('app.org_id', true), '') = '' OR "organizationId" = current_setting('app.org_id', true));

-- Row-level security (see 20…_row_level_security)
ALTER TABLE "SkillsChecklist" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "SkillsChecklist" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "SkillsChecklist" USING (coalesce(current_setting('app.org_id', true), '') = '' OR "organizationId" = current_setting('app.org_id', true)) WITH CHECK (coalesce(current_setting('app.org_id', true), '') = '' OR "organizationId" = current_setting('app.org_id', true));

-- Row-level security (see 20…_row_level_security)
ALTER TABLE "PayRule" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "PayRule" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "PayRule" USING (coalesce(current_setting('app.org_id', true), '') = '' OR "organizationId" = current_setting('app.org_id', true)) WITH CHECK (coalesce(current_setting('app.org_id', true), '') = '' OR "organizationId" = current_setting('app.org_id', true));

-- Row-level security (see 20…_row_level_security)
ALTER TABLE "TimesheetPremium" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "TimesheetPremium" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "TimesheetPremium" USING (coalesce(current_setting('app.org_id', true), '') = '' OR "organizationId" = current_setting('app.org_id', true)) WITH CHECK (coalesce(current_setting('app.org_id', true), '') = '' OR "organizationId" = current_setting('app.org_id', true));
