-- CreateTable
CREATE TABLE "HrAudit" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'OPEN',
    "findings" JSONB NOT NULL DEFAULT '[]',
    "answers" JSONB NOT NULL DEFAULT '{}',
    "reviews" JSONB NOT NULL DEFAULT '{}',
    "notes" TEXT,
    "score" INTEGER,
    "startedById" TEXT,
    "completedById" TEXT,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completedAt" TIMESTAMP(3),
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "HrAudit_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "HrAudit_organizationId_startedAt_idx" ON "HrAudit"("organizationId", "startedAt");

-- AddForeignKey
ALTER TABLE "HrAudit" ADD CONSTRAINT "HrAudit_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;


-- Row-level security (see 20…_row_level_security)
ALTER TABLE "HrAudit" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "HrAudit" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "HrAudit" USING (coalesce(current_setting('app.org_id', true), '') = '' OR "organizationId" = current_setting('app.org_id', true)) WITH CHECK (coalesce(current_setting('app.org_id', true), '') = '' OR "organizationId" = current_setting('app.org_id', true));
