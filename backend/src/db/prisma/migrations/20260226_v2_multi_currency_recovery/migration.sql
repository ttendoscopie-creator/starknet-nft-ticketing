-- AlterTable: Event — add multi-currency fields
ALTER TABLE "Event" ADD COLUMN "paymentTokenAddress" TEXT;
ALTER TABLE "Event" ADD COLUMN "acceptedCurrencies" TEXT[] DEFAULT ARRAY['STRK']::TEXT[];

-- AlterTable: PendingMint — add crypto payment fields, make stripePaymentIntentId optional
ALTER TABLE "PendingMint" ALTER COLUMN "stripePaymentIntentId" DROP NOT NULL;
ALTER TABLE "PendingMint" ADD COLUMN "cryptoTxHash" TEXT;
ALTER TABLE "PendingMint" ADD COLUMN "paymentAmount" BIGINT;
ALTER TABLE "PendingMint" ADD COLUMN "paymentCurrency" TEXT;
