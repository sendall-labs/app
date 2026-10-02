-- CreateEnum
CREATE TYPE "BatchKind" AS ENUM ('PAYMENT', 'CLAIMABLE_BALANCE');

-- CreateEnum
CREATE TYPE "DeliveryMethod" AS ENUM ('PAYMENT', 'CREATE_ACCOUNT', 'CLAIMABLE_BALANCE');

-- CreateEnum
CREATE TYPE "ClaimStatus" AS ENUM ('UNCLAIMED', 'CLAIMED', 'RECLAIMED');

-- CreateEnum
CREATE TYPE "ChannelStatus" AS ENUM ('AVAILABLE', 'RESERVED', 'SUBMITTED', 'AWAITING_CONFIRMATION', 'QUARANTINED');

-- CreateEnum
CREATE TYPE "RunPurpose" AS ENUM ('SEND', 'RECLAIM', 'REAUTHORIZE', 'CLEANUP');

-- CreateEnum
CREATE TYPE "RunStatus" AS ENUM ('CREATED', 'PAYMENTS_PREPARED', 'AWAITING_USER_SIGNATURE', 'SETUP_SUBMITTED', 'SETUP_CONFIRMED', 'PAYMENTS_SUBMITTING', 'COMPLETED', 'PARTIALLY_FAILED', 'FAILED', 'EXPIRED');

-- CreateEnum
CREATE TYPE "ChannelTxStatus" AS ENUM ('PREPARED', 'SUBMITTING', 'SUCCESS', 'FAILED', 'REAUTHORIZATION_REQUIRED', 'EXPIRED');

-- AlterTable
ALTER TABLE "Batch" ADD COLUMN     "claimExpiresAt" TIMESTAMP(3),
ADD COLUMN     "kind" "BatchKind" NOT NULL DEFAULT 'PAYMENT';

-- AlterTable
ALTER TABLE "Recipient" ADD COLUMN     "claimStatus" "ClaimStatus",
ADD COLUMN     "claimTxHash" TEXT,
ADD COLUMN     "claimableBalanceId" TEXT,
ADD COLUMN     "claimedAt" TIMESTAMP(3),
ADD COLUMN     "deliveryMethod" "DeliveryMethod";

-- CreateTable
CREATE TABLE "ChannelAccount" (
    "id" TEXT NOT NULL,
    "network" "Network" NOT NULL,
    "publicKey" TEXT NOT NULL,
    "encryptedSecret" TEXT NOT NULL,
    "status" "ChannelStatus" NOT NULL DEFAULT 'AVAILABLE',
    "expectedSequence" TEXT,
    "runId" TEXT,
    "transactionId" TEXT,
    "lockedAt" TIMESTAMP(3),
    "expiresAt" TIMESTAMP(3),
    "lastError" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ChannelAccount_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DistributionRun" (
    "id" TEXT NOT NULL,
    "batchId" TEXT NOT NULL,
    "purpose" "RunPurpose" NOT NULL DEFAULT 'SEND',
    "idempotencyKey" TEXT NOT NULL,
    "status" "RunStatus" NOT NULL DEFAULT 'CREATED',
    "network" "Network" NOT NULL,
    "sourceAccount" TEXT NOT NULL,
    "sponsorAccount" TEXT NOT NULL,
    "preAuthWeight" INTEGER,
    "parentRunId" TEXT,
    "setupXdr" TEXT,
    "setupHash" TEXT,
    "setupSignedXdr" TEXT,
    "setupFeeBumpXdr" TEXT,
    "setupTxHash" TEXT,
    "setupMaxTime" TIMESTAMP(3),
    "setupSubmittedAt" TIMESTAMP(3),
    "setupConfirmedAt" TIMESTAMP(3),
    "signedAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "errorCode" TEXT,
    "errorMessage" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "DistributionRun_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ChannelTransaction" (
    "id" TEXT NOT NULL,
    "runId" TEXT NOT NULL,
    "chunkIndex" INTEGER NOT NULL,
    "channelPublicKey" TEXT NOT NULL,
    "channelSequence" TEXT NOT NULL,
    "unsignedInnerXdr" TEXT NOT NULL,
    "transactionHash" TEXT NOT NULL,
    "feeBumpXdr" TEXT,
    "stellarTxHash" TEXT,
    "status" "ChannelTxStatus" NOT NULL DEFAULT 'PREPARED',
    "attemptCount" INTEGER NOT NULL DEFAULT 0,
    "errorCode" TEXT,
    "resultXdr" TEXT,
    "maxTime" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "submittedAt" TIMESTAMP(3),
    "confirmedAt" TIMESTAMP(3),

    CONSTRAINT "ChannelTransaction_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ChannelTransactionItem" (
    "id" TEXT NOT NULL,
    "transactionId" TEXT NOT NULL,
    "recipientId" TEXT NOT NULL,
    "operationIndex" INTEGER NOT NULL,
    "deliveryMethod" "DeliveryMethod" NOT NULL,
    "status" "ChannelTxStatus" NOT NULL DEFAULT 'PREPARED',
    "resultCode" TEXT,
    "claimableBalanceId" TEXT,

    CONSTRAINT "ChannelTransactionItem_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ChannelAccount_publicKey_key" ON "ChannelAccount"("publicKey");

-- CreateIndex
CREATE INDEX "ChannelAccount_network_status_idx" ON "ChannelAccount"("network", "status");

-- CreateIndex
CREATE UNIQUE INDEX "DistributionRun_idempotencyKey_key" ON "DistributionRun"("idempotencyKey");

-- CreateIndex
CREATE UNIQUE INDEX "DistributionRun_setupHash_key" ON "DistributionRun"("setupHash");

-- CreateIndex
CREATE INDEX "DistributionRun_batchId_idx" ON "DistributionRun"("batchId");

-- CreateIndex
CREATE INDEX "DistributionRun_status_idx" ON "DistributionRun"("status");

-- CreateIndex
CREATE UNIQUE INDEX "ChannelTransaction_transactionHash_key" ON "ChannelTransaction"("transactionHash");

-- CreateIndex
CREATE UNIQUE INDEX "ChannelTransaction_runId_chunkIndex_key" ON "ChannelTransaction"("runId", "chunkIndex");

-- CreateIndex
CREATE INDEX "ChannelTransactionItem_transactionId_idx" ON "ChannelTransactionItem"("transactionId");

-- CreateIndex
CREATE INDEX "ChannelTransactionItem_recipientId_idx" ON "ChannelTransactionItem"("recipientId");

-- AddForeignKey
ALTER TABLE "DistributionRun" ADD CONSTRAINT "DistributionRun_batchId_fkey" FOREIGN KEY ("batchId") REFERENCES "Batch"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ChannelTransaction" ADD CONSTRAINT "ChannelTransaction_runId_fkey" FOREIGN KEY ("runId") REFERENCES "DistributionRun"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ChannelTransactionItem" ADD CONSTRAINT "ChannelTransactionItem_transactionId_fkey" FOREIGN KEY ("transactionId") REFERENCES "ChannelTransaction"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ChannelTransactionItem" ADD CONSTRAINT "ChannelTransactionItem_recipientId_fkey" FOREIGN KEY ("recipientId") REFERENCES "Recipient"("id") ON DELETE CASCADE ON UPDATE CASCADE;
