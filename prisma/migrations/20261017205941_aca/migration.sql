-- CreateTable
CREATE TABLE "AcaPolicy" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "measurementMonths" INTEGER NOT NULL DEFAULT 12,
    "adminMonths" INTEGER NOT NULL DEFAULT 2,
    "stabilityMonths" INTEGER NOT NULL DEFAULT 12,
    "startMonth" INTEGER NOT NULL DEFAULT 11,
    "updatedById" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AcaPolicy_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AcaOffer" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "candidateId" TEXT NOT NULL,
    "offeredOn" DATE NOT NULL,
    "coverageStart" DATE NOT NULL,
    "coverageEnd" DATE,
    "coverage" TEXT NOT NULL,
    "minimumValue" BOOLEAN NOT NULL DEFAULT true,
    "employeeCost" DECIMAL(10,2) NOT NULL,
    "response" TEXT NOT NULL DEFAULT 'PENDING',
    "respondedOn" DATE,
    "note" TEXT,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AcaOffer_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "AcaPolicy_organizationId_key" ON "AcaPolicy"("organizationId");

-- CreateIndex
CREATE INDEX "AcaOffer_organizationId_candidateId_idx" ON "AcaOffer"("organizationId", "candidateId");

-- AddForeignKey
ALTER TABLE "AcaPolicy" ADD CONSTRAINT "AcaPolicy_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AcaOffer" ADD CONSTRAINT "AcaOffer_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AcaOffer" ADD CONSTRAINT "AcaOffer_candidateId_fkey" FOREIGN KEY ("candidateId") REFERENCES "Candidate"("id") ON DELETE CASCADE ON UPDATE CASCADE;


-- Row-level security (see 20…_row_level_security)
ALTER TABLE "AcaPolicy" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "AcaPolicy" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "AcaPolicy" USING (coalesce(current_setting('app.org_id', true), '') = '' OR "organizationId" = current_setting('app.org_id', true)) WITH CHECK (coalesce(current_setting('app.org_id', true), '') = '' OR "organizationId" = current_setting('app.org_id', true));

-- Row-level security (see 20…_row_level_security)
ALTER TABLE "AcaOffer" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "AcaOffer" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "AcaOffer" USING (coalesce(current_setting('app.org_id', true), '') = '' OR "organizationId" = current_setting('app.org_id', true)) WITH CHECK (coalesce(current_setting('app.org_id', true), '') = '' OR "organizationId" = current_setting('app.org_id', true));
