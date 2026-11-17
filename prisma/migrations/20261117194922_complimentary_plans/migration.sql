-- AlterTable
ALTER TABLE "Organization" ADD COLUMN     "complimentary" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "complimentaryNote" TEXT;
