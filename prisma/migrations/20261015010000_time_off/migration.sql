-- CreateEnum
CREATE TYPE "AccrualMethod" AS ENUM ('NONE', 'ANNUAL', 'HOURS_WORKED');

-- CreateEnum
CREATE TYPE "LeaveStatus" AS ENUM ('PENDING', 'APPROVED', 'DENIED', 'CANCELLED');

-- AlterTable
ALTER TABLE "PayrollItem" ADD COLUMN     "leaveHours" DECIMAL(6,2) NOT NULL DEFAULT 0,
ADD COLUMN     "leavePay" DECIMAL(12,2) NOT NULL DEFAULT 0;

-- AlterTable
ALTER TABLE "Timesheet" ADD COLUMN     "leaveHours" DECIMAL(6,2) NOT NULL DEFAULT 0;

-- CreateTable
CREATE TABLE "LeavePolicy" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "paid" BOOLEAN NOT NULL DEFAULT true,
    "method" "AccrualMethod" NOT NULL DEFAULT 'ANNUAL',
    "rate" DECIMAL(9,4) NOT NULL DEFAULT 0,
    "maxBalance" DECIMAL(8,2),
    "waitingDays" INTEGER NOT NULL DEFAULT 0,
    "types" "EmploymentType"[] DEFAULT ARRAY[]::"EmploymentType"[],
    "archived" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "LeavePolicy_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LeaveRequest" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "employeeId" TEXT NOT NULL,
    "policyId" TEXT NOT NULL,
    "startDate" DATE NOT NULL,
    "endDate" DATE NOT NULL,
    "hoursPerDay" DECIMAL(5,2) NOT NULL,
    "hours" DECIMAL(7,2) NOT NULL,
    "note" TEXT,
    "status" "LeaveStatus" NOT NULL DEFAULT 'PENDING',
    "byEmployee" BOOLEAN NOT NULL DEFAULT false,
    "createdById" TEXT,
    "decidedById" TEXT,
    "decidedAt" TIMESTAMP(3),
    "decisionNote" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "LeaveRequest_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LeaveEntry" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "employeeId" TEXT NOT NULL,
    "policyId" TEXT NOT NULL,
    "date" DATE NOT NULL,
    "hours" DECIMAL(7,2) NOT NULL,
    "kind" TEXT NOT NULL,
    "note" TEXT,
    "requestId" TEXT,
    "accrualKey" TEXT,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "LeaveEntry_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "LeavePolicy_organizationId_name_key" ON "LeavePolicy"("organizationId", "name");

-- CreateIndex
CREATE INDEX "LeaveRequest_organizationId_status_idx" ON "LeaveRequest"("organizationId", "status");

-- CreateIndex
CREATE INDEX "LeaveRequest_employeeId_startDate_idx" ON "LeaveRequest"("employeeId", "startDate");

-- CreateIndex
CREATE INDEX "LeaveEntry_employeeId_policyId_idx" ON "LeaveEntry"("employeeId", "policyId");

-- CreateIndex
CREATE INDEX "LeaveEntry_organizationId_date_idx" ON "LeaveEntry"("organizationId", "date");

-- CreateIndex
CREATE UNIQUE INDEX "LeaveEntry_organizationId_accrualKey_key" ON "LeaveEntry"("organizationId", "accrualKey");

-- AddForeignKey
ALTER TABLE "LeavePolicy" ADD CONSTRAINT "LeavePolicy_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LeaveRequest" ADD CONSTRAINT "LeaveRequest_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LeaveRequest" ADD CONSTRAINT "LeaveRequest_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "Employee"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LeaveRequest" ADD CONSTRAINT "LeaveRequest_policyId_fkey" FOREIGN KEY ("policyId") REFERENCES "LeavePolicy"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LeaveEntry" ADD CONSTRAINT "LeaveEntry_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LeaveEntry" ADD CONSTRAINT "LeaveEntry_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "Employee"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LeaveEntry" ADD CONSTRAINT "LeaveEntry_policyId_fkey" FOREIGN KEY ("policyId") REFERENCES "LeavePolicy"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LeaveEntry" ADD CONSTRAINT "LeaveEntry_requestId_fkey" FOREIGN KEY ("requestId") REFERENCES "LeaveRequest"("id") ON DELETE CASCADE ON UPDATE CASCADE;

