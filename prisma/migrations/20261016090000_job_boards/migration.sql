-- AlterTable
ALTER TABLE "Application" ADD COLUMN     "source" TEXT;

-- AlterTable
ALTER TABLE "Job" ADD COLUMN     "boards" TEXT[] DEFAULT ARRAY[]::TEXT[];

-- AlterTable
ALTER TABLE "Organization" ADD COLUMN     "jobBoards" TEXT[] DEFAULT ARRAY[]::TEXT[],
ADD COLUMN     "linkedinCompanyId" TEXT;


-- Companies that already used the board feeds keep the six boards they had, so nothing changes for them.
UPDATE "Organization" SET "jobBoards" = ARRAY['indeed','ziprecruiter','talent','jooble','careerjet','adzuna'];
