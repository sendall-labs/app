-- AlterTable
ALTER TABLE "Batch" ADD COLUMN     "anonId" TEXT,
ADD COLUMN     "claimedAt" TIMESTAMP(3),
ALTER COLUMN "ownerPublicKey" DROP NOT NULL,
ALTER COLUMN "sourceAccount" DROP NOT NULL;

-- CreateIndex
CREATE INDEX "Batch_anonId_idx" ON "Batch"("anonId");
