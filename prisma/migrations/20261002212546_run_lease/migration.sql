-- AlterTable
ALTER TABLE "DistributionRun" ADD COLUMN     "leaseOwner" TEXT,
ADD COLUMN     "leaseUntil" TIMESTAMP(3);
