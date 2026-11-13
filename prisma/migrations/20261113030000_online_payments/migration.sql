-- Clients pay invoices online through the firm's own Stripe account, and invoices remind clients before and after they're due.

-- AlterTable
ALTER TABLE "Organization" ADD COLUMN     "stripeConnectAccountId" TEXT,
ADD COLUMN     "stripeConnectReady" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "onlinePayments" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "cardFeePct" DECIMAL(4,2) NOT NULL DEFAULT 0,
ADD COLUMN     "invoiceReminders" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "Invoice" ADD COLUMN     "payToken" TEXT,
ADD COLUMN     "remindersSent" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "lastReminderAt" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "Payment" ADD COLUMN     "stripePaymentId" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "Organization_stripeConnectAccountId_key" ON "Organization"("stripeConnectAccountId");

-- CreateIndex
CREATE UNIQUE INDEX "Invoice_payToken_key" ON "Invoice"("payToken");

-- CreateIndex
CREATE UNIQUE INDEX "Payment_stripePaymentId_key" ON "Payment"("stripePaymentId");
