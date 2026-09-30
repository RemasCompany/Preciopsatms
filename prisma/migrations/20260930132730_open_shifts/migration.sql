-- CreateTable
CREATE TABLE "OpenShift" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "jobId" TEXT NOT NULL,
    "date" DATE NOT NULL,
    "start" TEXT NOT NULL,
    "end" TEXT NOT NULL,
    "breakMinutes" INTEGER NOT NULL DEFAULT 0,
    "unit" TEXT,
    "notes" TEXT,
    "slots" INTEGER NOT NULL DEFAULT 1,
    "filled" INTEGER NOT NULL DEFAULT 0,
    "status" TEXT NOT NULL DEFAULT 'OPEN',
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "OpenShift_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ShiftOffer" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "openShiftId" TEXT NOT NULL,
    "candidateId" TEXT NOT NULL,
    "applicationId" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'OFFERED',
    "sentAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "sentVia" TEXT,
    "respondedAt" TIMESTAMP(3),
    "shiftId" TEXT,

    CONSTRAINT "ShiftOffer_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "OpenShift_organizationId_date_idx" ON "OpenShift"("organizationId", "date");

-- CreateIndex
CREATE INDEX "ShiftOffer_organizationId_candidateId_status_idx" ON "ShiftOffer"("organizationId", "candidateId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "ShiftOffer_openShiftId_candidateId_key" ON "ShiftOffer"("openShiftId", "candidateId");

-- AddForeignKey
ALTER TABLE "OpenShift" ADD CONSTRAINT "OpenShift_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OpenShift" ADD CONSTRAINT "OpenShift_jobId_fkey" FOREIGN KEY ("jobId") REFERENCES "Job"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ShiftOffer" ADD CONSTRAINT "ShiftOffer_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ShiftOffer" ADD CONSTRAINT "ShiftOffer_openShiftId_fkey" FOREIGN KEY ("openShiftId") REFERENCES "OpenShift"("id") ON DELETE CASCADE ON UPDATE CASCADE;
