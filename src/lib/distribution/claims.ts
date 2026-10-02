import pLimit from "p-limit";
import { MuxedAccount, StrKey } from "@stellar/stellar-sdk";
import type { ClaimStatus, Network } from "@/generated/prisma/enums";
import { prisma } from "@/lib/db/prisma";
import { getHorizonServer } from "@/lib/stellar/client";

export type ClaimSummary = {
  created: number;
  unclaimed: number;
  claimed: number;
  reclaimed: number;
  expiresAt: Date | null;
  syncedAt: Date;
};

function baseAccount(address: string) {
  return StrKey.isValidMed25519PublicKey(address) ? MuxedAccount.fromAddress(address, "0").baseAccount().accountId() : address;
}

type Outcome = { status: ClaimStatus; txHash: string | null; at: Date | null };

/**
 * What happened to one balance. Still on the ledger: unclaimed. Gone: its
 * claim operation says who took it, the recipient (claimed) or the
 * sender after expiry (reclaimed).
 */
export async function balanceOutcome(network: Network, balanceId: string, recipient: string, sender: string): Promise<Outcome | null> {
  const horizon = getHorizonServer(network);
  try {
    await horizon.claimableBalances().claimableBalance(balanceId).call();
    return { status: "UNCLAIMED", txHash: null, at: null };
  } catch (err) {
    if ((err as { response?: { status?: number } }).response?.status !== 404) throw err;
  }
  const ops = await horizon.operations().forClaimableBalance(balanceId).order("desc").limit(20).call();
  const claim = ops.records.find((op) => op.type === "claim_claimable_balance") as
    | { source_account: string; transaction_hash: string; created_at: string }
    | undefined;
  if (!claim) return null; // history not available; leave as is
  const by = baseAccount(claim.source_account);
  // Only the two claimants can take it: the sender means a reclaim.
  void recipient;
  const status: ClaimStatus = by === baseAccount(sender) ? "RECLAIMED" : "CLAIMED";
  return { status, txHash: claim.transaction_hash, at: new Date(claim.created_at) };
}

/** Reads every still-unclaimed balance of the batch from Horizon and records what happened. */
export async function syncClaimStatuses(batchId: string): Promise<ClaimSummary> {
  const batch = await prisma.batch.findUniqueOrThrow({ where: { id: batchId } });
  const open = await prisma.recipient.findMany({
    where: { batchId, claimableBalanceId: { not: null }, claimStatus: "UNCLAIMED" },
    select: { id: true, destination: true, claimableBalanceId: true },
  });
  const sender = batch.sourceAccount ?? batch.ownerPublicKey ?? "";
  const limit = pLimit(5);
  await Promise.all(
    open.map((r) =>
      limit(async () => {
        const outcome = await balanceOutcome(batch.network, r.claimableBalanceId!, r.destination, sender).catch(() => null);
        if (!outcome || outcome.status === "UNCLAIMED") return;
        await prisma.recipient.update({
          where: { id: r.id },
          data: { claimStatus: outcome.status, claimTxHash: outcome.txHash, claimedAt: outcome.at },
        });
      })
    )
  );
  return claimSummary(batchId);
}

export async function claimSummary(batchId: string): Promise<ClaimSummary> {
  const batch = await prisma.batch.findUniqueOrThrow({ where: { id: batchId }, select: { claimExpiresAt: true } });
  const groups = await prisma.recipient.groupBy({
    by: ["claimStatus"],
    where: { batchId, claimStatus: { not: null } },
    _count: { _all: true },
  });
  const count = (s: ClaimStatus) => groups.find((g) => g.claimStatus === s)?._count._all ?? 0;
  const unclaimed = count("UNCLAIMED");
  const claimed = count("CLAIMED");
  const reclaimed = count("RECLAIMED");
  return { created: unclaimed + claimed + reclaimed, unclaimed, claimed, reclaimed, expiresAt: batch.claimExpiresAt, syncedAt: new Date() };
}
