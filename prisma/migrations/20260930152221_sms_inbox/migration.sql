-- AlterTable
ALTER TABLE "Contact" ADD COLUMN     "emailOptOut" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "smsOptOut" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "Lead" ADD COLUMN     "emailOptOut" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "smsOptOut" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "Message" ADD COLUMN     "direction" TEXT NOT NULL DEFAULT 'out',
ADD COLUMN     "fromAddress" TEXT,
ADD COLUMN     "readAt" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "Organization" ADD COLUMN     "smsNumber" TEXT;

-- CreateIndex
CREATE INDEX "Message_organizationId_channel_direction_readAt_idx" ON "Message"("organizationId", "channel", "direction", "readAt");

-- CreateIndex
CREATE UNIQUE INDEX "Organization_smsNumber_key" ON "Organization"("smsNumber");

