-- CreateTable
CREATE TABLE "CheckrConnection" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "accountName" TEXT,
    "accessTokenEnc" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "credentialedAt" TIMESTAMP(3),
    "connectedById" TEXT,
    "connectedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CheckrConnection_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "CheckrConnection_organizationId_key" ON "CheckrConnection"("organizationId");

-- CreateIndex
CREATE UNIQUE INDEX "CheckrConnection_accountId_key" ON "CheckrConnection"("accountId");

-- CreateIndex
CREATE UNIQUE INDEX "CheckrConnection_tokenHash_key" ON "CheckrConnection"("tokenHash");

-- AddForeignKey
ALTER TABLE "CheckrConnection" ADD CONSTRAINT "CheckrConnection_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;


-- Row-level security (see 20…_row_level_security)
ALTER TABLE "CheckrConnection" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "CheckrConnection" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "CheckrConnection" USING (coalesce(current_setting('app.org_id', true), '') = '' OR "organizationId" = current_setting('app.org_id', true)) WITH CHECK (coalesce(current_setting('app.org_id', true), '') = '' OR "organizationId" = current_setting('app.org_id', true));
