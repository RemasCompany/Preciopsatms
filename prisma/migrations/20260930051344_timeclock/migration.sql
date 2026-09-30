-- AlterTable
ALTER TABLE "Organization" ADD COLUMN     "timezone" TEXT NOT NULL DEFAULT 'America/New_York';

-- AlterTable
ALTER TABLE "WorkerLink" ADD COLUMN     "kind" TEXT NOT NULL DEFAULT 'schedule',
ADD COLUMN     "revokedAt" TIMESTAMP(3);

-- CreateTable
CREATE TABLE "TimeEntry" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "applicationId" TEXT NOT NULL,
    "shiftId" TEXT,
    "clockIn" TIMESTAMP(3) NOT NULL,
    "clockOut" TIMESTAMP(3),
    "breakMinutes" INTEGER NOT NULL DEFAULT 0,
    "breakStartedAt" TIMESTAMP(3),
    "source" TEXT NOT NULL DEFAULT 'WORKER',
    "inLat" DOUBLE PRECISION,
    "inLng" DOUBLE PRECISION,
    "inAccuracy" DOUBLE PRECISION,
    "outLat" DOUBLE PRECISION,
    "outLng" DOUBLE PRECISION,
    "outAccuracy" DOUBLE PRECISION,
    "note" TEXT,
    "originalClockIn" TIMESTAMP(3),
    "originalClockOut" TIMESTAMP(3),
    "editedById" TEXT,
    "editedAt" TIMESTAMP(3),
    "editReason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TimeEntry_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "TimeEntry_organizationId_clockIn_idx" ON "TimeEntry"("organizationId", "clockIn");

-- CreateIndex
CREATE INDEX "TimeEntry_applicationId_clockIn_idx" ON "TimeEntry"("applicationId", "clockIn");

-- AddForeignKey
ALTER TABLE "TimeEntry" ADD CONSTRAINT "TimeEntry_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TimeEntry" ADD CONSTRAINT "TimeEntry_applicationId_fkey" FOREIGN KEY ("applicationId") REFERENCES "Application"("id") ON DELETE CASCADE ON UPDATE CASCADE;
