-- CreateEnum
CREATE TYPE "Network" AS ENUM ('TESTNET', 'PUBLIC');

-- CreateEnum
CREATE TYPE "BatchStatus" AS ENUM ('DRAFT', 'VALIDATING', 'VALIDATED', 'CHECKING', 'READY', 'SUBMITTING', 'PARTIAL_FAILURE', 'COMPLETED', 'FAILED');

-- CreateEnum
CREATE TYPE "LineItemStatus" AS ENUM ('PENDING', 'VALIDATION_FAILED', 'CHECK_FAILED', 'READY', 'IN_TRANSACTION', 'SUCCESS', 'FAILED');

-- CreateEnum
CREATE TYPE "AttemptStatus" AS ENUM ('BUILT', 'SIGNED', 'SUBMITTED', 'SUCCESS', 'FAILED');

-- CreateTable
CREATE TABLE "Batch" (
    "id" TEXT NOT NULL,
    "ownerPublicKey" TEXT NOT NULL,
    "network" "Network" NOT NULL,
    "assetCode" TEXT,
    "assetIssuer" TEXT,
    "sourceAccount" TEXT NOT NULL,
    "status" "BatchStatus" NOT NULL DEFAULT 'DRAFT',
    "csvFileName" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Batch_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Recipient" (
    "id" TEXT NOT NULL,
    "batchId" TEXT NOT NULL,
    "rowIndex" INTEGER NOT NULL,
    "destination" TEXT NOT NULL,
    "amount" DECIMAL(65,30) NOT NULL,
    "memo" TEXT,
    "addressValid" BOOLEAN NOT NULL DEFAULT false,
    "isDuplicate" BOOLEAN NOT NULL DEFAULT false,
    "accountExists" BOOLEAN,
    "hasTrustline" BOOLEAN,
    "trustlineLimitOk" BOOLEAN,
    "status" "LineItemStatus" NOT NULL DEFAULT 'PENDING',
    "errorMessage" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Recipient_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PaymentAttempt" (
    "id" TEXT NOT NULL,
    "batchId" TEXT NOT NULL,
    "chunkIndex" INTEGER NOT NULL,
    "sequenceNumber" TEXT,
    "operationCount" INTEGER NOT NULL,
    "status" "AttemptStatus" NOT NULL DEFAULT 'BUILT',
    "txHash" TEXT,
    "xdrEnvelope" TEXT,
    "resultXdr" TEXT,
    "errorCode" TEXT,
    "submittedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PaymentAttempt_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PaymentAttemptItem" (
    "id" TEXT NOT NULL,
    "attemptId" TEXT NOT NULL,
    "recipientId" TEXT NOT NULL,
    "operationIndex" INTEGER NOT NULL,
    "resultCode" TEXT,
    "status" "AttemptStatus" NOT NULL DEFAULT 'BUILT',

    CONSTRAINT "PaymentAttemptItem_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Batch_ownerPublicKey_idx" ON "Batch"("ownerPublicKey");

-- CreateIndex
CREATE INDEX "Recipient_batchId_idx" ON "Recipient"("batchId");

-- CreateIndex
CREATE INDEX "PaymentAttempt_batchId_idx" ON "PaymentAttempt"("batchId");

-- CreateIndex
CREATE INDEX "PaymentAttemptItem_attemptId_idx" ON "PaymentAttemptItem"("attemptId");

-- CreateIndex
CREATE INDEX "PaymentAttemptItem_recipientId_idx" ON "PaymentAttemptItem"("recipientId");

-- AddForeignKey
ALTER TABLE "Recipient" ADD CONSTRAINT "Recipient_batchId_fkey" FOREIGN KEY ("batchId") REFERENCES "Batch"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PaymentAttempt" ADD CONSTRAINT "PaymentAttempt_batchId_fkey" FOREIGN KEY ("batchId") REFERENCES "Batch"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PaymentAttemptItem" ADD CONSTRAINT "PaymentAttemptItem_attemptId_fkey" FOREIGN KEY ("attemptId") REFERENCES "PaymentAttempt"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PaymentAttemptItem" ADD CONSTRAINT "PaymentAttemptItem_recipientId_fkey" FOREIGN KEY ("recipientId") REFERENCES "Recipient"("id") ON DELETE CASCADE ON UPDATE CASCADE;
