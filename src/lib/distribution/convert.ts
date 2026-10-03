import { prisma } from "@/lib/db/prisma";
import { claimDeadline, DEFAULT_CLAIM_WINDOW_DAYS } from "./claimWindow";
import { isConvertible, MOVED_NOTE } from "./convertRules";
import { DistributionError } from "./errors";

export { isConvertible, MOVED_NOTE };

/**
 * Starts a claimable balance batch from a payment batch's rows that could
 * not receive the asset. The original rows are marked as moved so they
 * are never sent twice from the old batch.
 */
export async function convertFailedToClaimable(batchId: string, ownerPublicKey: string) {
  const batch = await prisma.batch.findFirst({
    where: { id: batchId, ownerPublicKey },
    include: {
      recipients: {
        orderBy: { rowIndex: "asc" },
        include: { channelItems: { orderBy: { id: "desc" }, take: 1, select: { resultCode: true } } },
      },
    },
  });
  if (!batch) throw new DistributionError("INVALID_STATE", "Batch not found.");
  if (batch.kind !== "PAYMENT") throw new DistributionError("INVALID_STATE", "Only payment batches can be converted.");
  const native = !batch.assetCode;
  const rows = batch.recipients.filter((r) => isConvertible({ ...r, lastResultCode: r.channelItems[0]?.resultCode }, native));
  if (rows.length === 0) throw new DistributionError("PREFLIGHT_FAILED", "No failed rows that a claimable balance would fix.");

  return prisma.$transaction(async (tx) => {
    const created = await tx.batch.create({
      data: {
        ownerPublicKey: batch.ownerPublicKey,
        sourceAccount: batch.sourceAccount,
        claimedAt: new Date(),
        network: batch.network,
        assetCode: batch.assetCode,
        assetIssuer: batch.assetIssuer,
        kind: "CLAIMABLE_BALANCE",
        claimWindowDays: DEFAULT_CLAIM_WINDOW_DAYS,
        claimExpiresAt: claimDeadline(DEFAULT_CLAIM_WINDOW_DAYS),
        csvFileName: batch.csvFileName ? `${batch.csvFileName} (claimable)` : null,
        status: "VALIDATED",
        recipients: {
          create: rows.map((r, i) => ({
            rowIndex: i + 1,
            destination: r.destination,
            amount: r.amount,
            addressValid: true,
            status: "PENDING" as const,
          })),
        },
      },
    });
    await tx.recipient.updateMany({
      where: { id: { in: rows.map((r) => r.id) } },
      data: { status: "CHECK_FAILED", errorMessage: MOVED_NOTE },
    });
    return { batchId: created.id, moved: rows.length };
  });
}
