import pLimit from "p-limit";
import { Asset } from "@stellar/stellar-sdk";
import { prisma } from "@/lib/db/prisma";
import { getHorizonServer } from "@/lib/stellar/client";
import { getBaseReserveStroops, loadAccountFunds } from "./reserve";
import type { DistributionOp } from "./buildChunks";
import { syncClaimStatuses } from "./claims";
import { prepareRun, type PreparedRun } from "./engine";
import { DistributionError } from "./errors";

/**
 * When the sender may take a balance back: the moment the sender's own
 * claimant predicate (not before T) opens. Read from the ledger, since
 * that is what the network will enforce.
 */
export async function reclaimableAt(network: Parameters<typeof getHorizonServer>[0], balanceId: string, sender: string): Promise<Date | null> {
  try {
    const balance = await getHorizonServer(network).claimableBalances().claimableBalance(balanceId).call();
    const mine = balance.claimants.find((c) => c.destination === sender);
    const notBefore = mine?.predicate.not?.abs_before;
    return notBefore ? new Date(notBefore) : null;
  } catch {
    return null; // gone or unreadable: nothing to reclaim
  }
}

/**
 * Prepares one run that claims every expired, unclaimed balance of the
 * batch back to the sender: claimClaimableBalance operations sourced from
 * the sender, through the same channel engine and single signature.
 */
export async function prepareReclaim(batchId: string, ownerPublicKey: string, idempotencyKey: string): Promise<PreparedRun & { count: number }> {
  const batch = await prisma.batch.findFirst({ where: { id: batchId, ownerPublicKey } });
  if (!batch) throw new DistributionError("INVALID_STATE", "Batch not found.");
  if (batch.kind !== "CLAIMABLE_BALANCE" || !batch.sourceAccount) throw new DistributionError("INVALID_STATE", "Only sent claimable balance batches can be reclaimed.");
  const key = `${batch.id}:reclaim:${idempotencyKey}`;

  const existing = await prisma.distributionRun.findUnique({ where: { idempotencyKey: key }, include: { _count: { select: { transactions: true } } } });
  if (existing?.setupXdr) {
    const count = await prisma.channelTransactionItem.count({ where: { transaction: { runId: existing.id } } });
    return { runId: existing.id, setupXdr: existing.setupXdr, transactionCount: existing._count.transactions, status: existing.status, count };
  }
  const active = await prisma.distributionRun.findFirst({
    where: { batchId: batch.id, status: { notIn: ["COMPLETED", "PARTIALLY_FAILED", "FAILED", "EXPIRED"] } },
  });
  if (active) throw new DistributionError("INVALID_STATE", "Another run for this batch is still in progress.", { runId: active.id });

  // Only what is truly still out there.
  await syncClaimStatuses(batch.id);
  const open = await prisma.recipient.findMany({
    where: { batchId: batch.id, claimStatus: "UNCLAIMED", claimableBalanceId: { not: null } },
    orderBy: { rowIndex: "asc" },
  });
  const now = Date.now();
  const limit = pLimit(5);
  const due = (
    await Promise.all(
      open.map((r) =>
        limit(async () => {
          const at = await reclaimableAt(batch.network, r.claimableBalanceId!, batch.sourceAccount!);
          return at && at.getTime() <= now ? r : null;
        })
      )
    )
  ).filter((r): r is NonNullable<typeof r> => r !== null);
  if (due.length === 0) {
    throw new DistributionError("PREFLIGHT_FAILED", open.length ? "The claim window has not closed yet. Unclaimed balances can be reclaimed after it does." : "Nothing left to reclaim.");
  }

  // A non-native asset comes back only if the sender still holds it.
  const asset = batch.assetCode && batch.assetIssuer ? new Asset(batch.assetCode, batch.assetIssuer) : null;
  if (asset && asset.getIssuer() !== batch.sourceAccount) {
    const funds = await loadAccountFunds(batch.network, batch.sourceAccount, await getBaseReserveStroops(batch.network), {
      code: asset.getCode(),
      issuer: asset.getIssuer()!,
    });
    if (funds.assetBalance === null) {
      throw new DistributionError("PREFLIGHT_FAILED", `Add a ${asset.getCode()} trustline back to your account before reclaiming.`);
    }
  }

  const ops: DistributionOp[] = due.map((r) => ({ kind: "claimClaimableBalance", recipientId: r.id, balanceId: r.claimableBalanceId! }));
  const prepared = await prepareRun({
    batchId: batch.id,
    network: batch.network,
    sourceAccount: batch.sourceAccount,
    idempotencyKey: key,
    asset,
    ops,
    purpose: "RECLAIM",
  });
  return { ...prepared, count: due.length };
}
