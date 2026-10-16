-- AlterTable
ALTER TABLE "Client" ADD COLUMN     "billingAddress" TEXT,
ADD COLUMN     "billingContactId" TEXT,
ADD COLUMN     "billingEmail" TEXT,
ADD COLUMN     "poNumber" TEXT,
ADD COLUMN     "taxRatePct" DECIMAL(6,3);

-- AlterTable
ALTER TABLE "Invoice" ADD COLUMN     "billToAddress" TEXT,
ADD COLUMN     "billToName" TEXT,
ADD COLUMN     "poNumber" TEXT,
ADD COLUMN     "subtotal" DECIMAL(12,2) NOT NULL DEFAULT 0,
ADD COLUMN     "taxAmount" DECIMAL(12,2) NOT NULL DEFAULT 0,
ADD COLUMN     "taxRatePct" DECIMAL(6,3) NOT NULL DEFAULT 0;

-- AlterTable
ALTER TABLE "InvoiceLine" ADD COLUMN     "approvedBy" TEXT,
ADD COLUMN     "kind" TEXT NOT NULL DEFAULT 'hours',
ADD COLUMN     "quantity" DECIMAL(10,2),
ADD COLUMN     "sortOrder" INTEGER NOT NULL DEFAULT 0;

-- AlterTable
ALTER TABLE "Organization" ADD COLUMN     "billingAddress" TEXT,
ADD COLUMN     "billingEmail" TEXT,
ADD COLUMN     "billingPhone" TEXT,
ADD COLUMN     "invoiceFooter" TEXT,
ADD COLUMN     "remitInstructions" TEXT,
ADD COLUMN     "taxId" TEXT;


-- Invoices made before this change: everything was labor, no tax.
UPDATE "Invoice" SET "subtotal" = "total";
