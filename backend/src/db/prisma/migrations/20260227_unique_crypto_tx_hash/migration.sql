-- AlterTable: add unique constraint on cryptoTxHash to prevent tx replay
CREATE UNIQUE INDEX "PendingMint_cryptoTxHash_key" ON "PendingMint"("cryptoTxHash");
