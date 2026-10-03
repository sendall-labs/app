import type { Network } from "@/generated/prisma/enums";
import { prisma } from "@/lib/db/prisma";
import { fromStroops, toStroops } from "@/lib/distribution/reserve";

export type ReceiptRow = {
  index: number;
  address: string;
  amount: string;
  method: "Payment" | "Account creation" | "Claimable balance";
  status: string;
  delivered: boolean;
  txHash: string | null;
};

export type ReceiptData = {
  number: string;
  batchId: string;
  title: string;
  sender: string;
  network: Network;
  asset: { code: string; issuer: string | null };
  kind: "PAYMENT" | "CLAIMABLE_BALANCE";
  date: Date;
  claimDeadline: Date | null;
  recipientCount: number;
  deliveredCount: number;
  deliveredAmount: string;
  failedCount: number;
  transactionCount: number;
  authorizationTxs: string[];
  rows: ReceiptRow[];
};

const METHOD = { PAYMENT: "Payment", CREATE_ACCOUNT: "Account creation", CLAIMABLE_BALANCE: "Claimable balance" } as const;
const CLAIM = { UNCLAIMED: "Set aside, unclaimed", CLAIMED: "Claimed by recipient", RECLAIMED: "Reclaimed by sender" } as const;

/**
 * Everything the receipt shows, read from what Sendall recorded for the
 * batch: which rows went out, how, and in which transaction. Covers both
 * channel engine runs and Phase 1 (sequential) sends.
 */
export async function loadReceipt(batchId: string): Promise<ReceiptData> {
  const batch = await prisma.batch.findUniqueOrThrow({
    where: { id: batchId },
    include: {
      recipients: {
        orderBy: { rowIndex: "asc" },
        include: {
          channelItems: { where: { status: "SUCCESS" }, include: { transaction: { select: { stellarTxHash: true, transactionHash: true } } } },
          attemptItems: { where: { status: "SUCCESS" }, include: { attempt: { select: { txHash: true } } } },
        },
      },
      runs: { where: { purpose: { in: ["SEND", "REAUTHORIZE"] }, signedAt: { not: null } }, orderBy: { createdAt: "asc" } },
    },
  });

  const native = !batch.assetCode;
  const rows: ReceiptRow[] = [];
  const txs = new Set<string>();
  let delivered = BigInt(0);
  let deliveredCount = 0;

  // Rows that never left the draft (empty lines, moved rows) are not part
  // of the distribution.
  const included = batch.recipients.filter((r) => r.status !== "PENDING" && r.status !== "VALIDATION_FAILED");
  included.forEach((r, i) => {
    const channel = r.channelItems[0];
    const legacy = r.attemptItems[0];
    const txHash = channel ? (channel.transaction.stellarTxHash ?? channel.transaction.transactionHash) : (legacy?.attempt.txHash ?? null);
    const ok = r.status === "SUCCESS";
    if (txHash) txs.add(txHash);
    if (ok) {
      delivered += toStroops(r.amount.toString());
      deliveredCount++;
    }
    const method =
      METHOD[(r.deliveryMethod ?? (native && r.accountExists === false ? "CREATE_ACCOUNT" : batch.kind === "CLAIMABLE_BALANCE" ? "CLAIMABLE_BALANCE" : "PAYMENT")) as keyof typeof METHOD];
    const status = ok
      ? r.claimStatus
        ? CLAIM[r.claimStatus]
        : "Delivered"
      : r.status === "FAILED"
        ? "Not delivered"
        : r.status === "IN_TRANSACTION"
          ? "In progress"
          : "Not sent";
    rows.push({ index: i + 1, address: r.destination, amount: r.amount.toString(), method, status, delivered: ok, txHash: ok ? txHash : null });
  });

  const lastRun = batch.runs.at(-1);
  return {
    number: `SND-${batch.id.slice(-8).toUpperCase()}`,
    batchId: batch.id,
    title: batch.csvFileName ?? (batch.kind === "CLAIMABLE_BALANCE" ? "Claimable balance distribution" : "Payment distribution"),
    sender: batch.sourceAccount ?? batch.ownerPublicKey ?? "",
    network: batch.network,
    asset: { code: batch.assetCode ?? "XLM", issuer: batch.assetIssuer },
    kind: batch.kind,
    date: lastRun?.completedAt ?? batch.updatedAt,
    claimDeadline: batch.kind === "CLAIMABLE_BALANCE" ? batch.claimExpiresAt : null,
    recipientCount: rows.length,
    deliveredCount,
    deliveredAmount: fromStroops(delivered),
    failedCount: rows.filter((r) => !r.delivered).length,
    transactionCount: txs.size,
    authorizationTxs: batch.runs.map((r) => r.setupTxHash).filter((h): h is string => !!h),
    rows,
  };
}
