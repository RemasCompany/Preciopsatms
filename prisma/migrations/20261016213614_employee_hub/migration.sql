-- AlterTable
ALTER TABLE "Candidate" ADD COLUMN     "photoFileId" TEXT;

-- AlterTable
ALTER TABLE "Employee" ADD COLUMN     "bio" TEXT,
ADD COLUMN     "emergencyName" TEXT,
ADD COLUMN     "emergencyPhone" TEXT,
ADD COLUMN     "emergencyRelation" TEXT,
ADD COLUMN     "homeAddress" TEXT,
ADD COLUMN     "preferredName" TEXT,
ADD COLUMN     "profileCompletedAt" TIMESTAMP(3),
ADD COLUMN     "pronouns" TEXT;

-- AlterTable
ALTER TABLE "Job" ADD COLUMN     "internal" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "Task" ADD COLUMN     "details" TEXT,
ADD COLUMN     "doneAt" TIMESTAMP(3),
ADD COLUMN     "employeeId" TEXT,
ADD COLUMN     "employeeSeenAt" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "TrainingCourse" ADD COLUMN     "signup" TEXT NOT NULL DEFAULT 'none';

-- AlterTable
ALTER TABLE "TrainingEnrollment" ADD COLUMN     "requestNote" TEXT;

-- CreateTable
CREATE TABLE "TaskComment" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "taskId" TEXT NOT NULL,
    "byEmployee" BOOLEAN NOT NULL DEFAULT false,
    "authorName" TEXT NOT NULL,
    "userId" TEXT,
    "body" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TaskComment_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "TaskComment_organizationId_taskId_idx" ON "TaskComment"("organizationId", "taskId");

-- CreateIndex
CREATE INDEX "Task_organizationId_employeeId_idx" ON "Task"("organizationId", "employeeId");

-- AddForeignKey
ALTER TABLE "Task" ADD CONSTRAINT "Task_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "Employee"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TaskComment" ADD CONSTRAINT "TaskComment_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TaskComment" ADD CONSTRAINT "TaskComment_taskId_fkey" FOREIGN KEY ("taskId") REFERENCES "Task"("id") ON DELETE CASCADE ON UPDATE CASCADE;

