-- AlterTable
ALTER TABLE "Client" ADD COLUMN     "onboardingMode" TEXT NOT NULL DEFAULT 'ask',
ADD COLUMN     "onboardingPackageId" TEXT;

-- AlterTable
ALTER TABLE "Organization" ADD COLUMN     "onboardingEnabled" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN     "onboardingEnforcement" TEXT NOT NULL DEFAULT 'warn';
