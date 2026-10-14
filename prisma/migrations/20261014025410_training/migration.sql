-- AlterTable
ALTER TABLE "Job" ADD COLUMN     "requiredCerts" TEXT[] DEFAULT ARRAY[]::TEXT[];

-- CreateTable
CREATE TABLE "TrainingCourse" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "certType" TEXT NOT NULL,
    "description" TEXT,
    "recertMonths" INTEGER NOT NULL DEFAULT 36,
    "passScore" INTEGER NOT NULL DEFAULT 80,
    "lessons" JSONB NOT NULL,
    "questions" JSONB NOT NULL,
    "checklist" JSONB NOT NULL,
    "archived" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TrainingCourse_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TrainingEnrollment" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "courseId" TEXT NOT NULL,
    "candidateId" TEXT NOT NULL,
    "reason" TEXT NOT NULL DEFAULT 'initial',
    "trigger" TEXT,
    "status" TEXT NOT NULL DEFAULT 'assigned',
    "dueDate" DATE,
    "assignedById" TEXT,
    "invitedAt" TIMESTAMP(3),
    "lessonsDone" INTEGER[] DEFAULT ARRAY[]::INTEGER[],
    "quizAttempts" INTEGER NOT NULL DEFAULT 0,
    "quizScore" INTEGER,
    "quizPassedAt" TIMESTAMP(3),
    "trainedAt" DATE,
    "evaluatedAt" DATE,
    "evaluatorName" TEXT,
    "evaluatorTitle" TEXT,
    "equipment" TEXT,
    "checklist" JSONB,
    "evalNotes" TEXT,
    "recordedById" TEXT,
    "credentialId" TEXT,
    "certifiedAt" TIMESTAMP(3),
    "expiresAt" DATE,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TrainingEnrollment_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "TrainingCourse_organizationId_archived_idx" ON "TrainingCourse"("organizationId", "archived");

-- CreateIndex
CREATE INDEX "TrainingEnrollment_organizationId_status_idx" ON "TrainingEnrollment"("organizationId", "status");

-- CreateIndex
CREATE INDEX "TrainingEnrollment_organizationId_candidateId_idx" ON "TrainingEnrollment"("organizationId", "candidateId");

-- AddForeignKey
ALTER TABLE "TrainingCourse" ADD CONSTRAINT "TrainingCourse_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TrainingEnrollment" ADD CONSTRAINT "TrainingEnrollment_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TrainingEnrollment" ADD CONSTRAINT "TrainingEnrollment_courseId_fkey" FOREIGN KEY ("courseId") REFERENCES "TrainingCourse"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TrainingEnrollment" ADD CONSTRAINT "TrainingEnrollment_candidateId_fkey" FOREIGN KEY ("candidateId") REFERENCES "Candidate"("id") ON DELETE CASCADE ON UPDATE CASCADE;

