-- AlterTable
ALTER TABLE "Organization" ADD COLUMN     "ssoRequired" BOOLEAN NOT NULL DEFAULT false;

-- CreateTable
CREATE TABLE "SsoConnection" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "workosOrgId" TEXT NOT NULL,
    "domains" TEXT[],
    "state" TEXT NOT NULL DEFAULT 'draft',
    "connectionType" TEXT,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SsoConnection_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "SsoConnection_organizationId_key" ON "SsoConnection"("organizationId");

-- CreateIndex
CREATE UNIQUE INDEX "SsoConnection_workosOrgId_key" ON "SsoConnection"("workosOrgId");

-- AddForeignKey
ALTER TABLE "SsoConnection" ADD CONSTRAINT "SsoConnection_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;


-- Row-level security (see 20…_row_level_security)
ALTER TABLE "SsoConnection" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "SsoConnection" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "SsoConnection" USING (coalesce(current_setting('app.org_id', true), '') = '' OR "organizationId" = current_setting('app.org_id', true)) WITH CHECK (coalesce(current_setting('app.org_id', true), '') = '' OR "organizationId" = current_setting('app.org_id', true));
