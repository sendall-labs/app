import { Asset } from "@stellar/stellar-sdk";
import type { Batch, DistributionRun, Recipient } from "@/generated/prisma/client";
import { prisma } from "@/lib/db/prisma";
import type { DistributionOp } from "./buildChunks";
import { isTerminalRun, prepareRun, type PreparedRun } from "./engine";
import { DistributionError } from "./errors";

export function batchAsset(batch: Pick<Batch, "assetCode" | "assetIssuer">): Asset | null {
  return batch.assetCode && batch.assetIssuer ? new Asset(batch.assetCode, batch.assetIssuer) : null;
}

/** Turns the batch's ready rows into engine operations for its kind. */
export function opsForBatch(
  batch: Pick<Batch, "kind" | "assetCode" | "assetIssuer">,
  recipients: Pick<Recipient, "id" | "destination" | "amount" | "accountExists">[]
): DistributionOp[] {
  const native = !batchAsset(batch);
  return recipients.map((r) => {
    const base = { recipientId: r.id, destination: r.destination, amount: r.amount.toString() };
    if (batch.kind === "CLAIMABLE_BALANCE") return { kind: "createClaimableBalance", ...base };
    if (native && r.accountExists === false) return { kind: "createAccount", ...base };
    return { kind: "payment", ...base };
  });
}

/**
 * Prepares a run for the batch's READY rows and marks them as in flight,
 * so a second prepare cannot include the same rows. A batch never has
 * two unfinished send runs at once.
 */
export async function prepareBatchRun(params: {
  batch: Batch & { recipients: Recipient[] };
  idempotencyKey: string;
  purpose?: "SEND" | "REAUTHORIZE";
  parentRunId?: string;
}): Promise<PreparedRun> {
  const { batch } = params;
  const key = `${batch.id}:${params.idempotencyKey}`;
  const existing = await prisma.distributionRun.findUnique({
    where: { idempotencyKey: key },
    include: { _count: { select: { transactions: true } } },
  });
  if (existing) {
    if (!existing.setupXdr) throw new DistributionError("INVALID_STATE", `Run did not finish preparing (${existing.status}).`, { runId: existing.id });
    return { runId: existing.id, setupXdr: existing.setupXdr, transactionCount: existing._count.transactions, status: existing.status };
  }

  const active = await prisma.distributionRun.findFirst({
    where: { batchId: batch.id, purpose: { in: ["SEND", "REAUTHORIZE"] }, status: { notIn: ["COMPLETED", "PARTIALLY_FAILED", "FAILED", "EXPIRED"] } },
  });
  if (active) {
    throw new DistributionError("INVALID_STATE", "This distribution is already in progress.", { runId: active.id });
  }
  if (!batch.sourceAccount) throw new DistributionError("INVALID_STATE", "Connect a wallet before sending.");
  if (batch.kind === "CLAIMABLE_BALANCE" && (!batch.claimExpiresAt || batch.claimExpiresAt <= new Date())) {
    throw new DistributionError("PREFLIGHT_FAILED", "Pick a claim expiry in the future.");
  }

  const ready = batch.recipients.filter((r) => r.status === "READY").sort((a, b) => a.rowIndex - b.rowIndex);
  if (ready.length === 0) throw new DistributionError("PREFLIGHT_FAILED", "No rows are ready to send.");

  const prepared = await prepareRun({
    batchId: batch.id,
    network: batch.network,
    sourceAccount: batch.sourceAccount,
    idempotencyKey: key,
    asset: batchAsset(batch),
    ops: opsForBatch(batch, ready),
    claimExpiresAt: batch.claimExpiresAt ?? undefined,
    purpose: params.purpose ?? "SEND",
    parentRunId: params.parentRunId,
  });
  await prisma.recipient.updateMany({ where: { id: { in: ready.map((r) => r.id) } }, data: { status: "IN_TRANSACTION", errorMessage: null } });
  await prisma.batch.update({ where: { id: batch.id }, data: { status: "SUBMITTING" } });
  return prepared;
}

/** Rows from a finished run that can only go out again with a new signature. */
export async function rowsNeedingReauthorization(runId: string): Promise<string[]> {
  const items = await prisma.channelTransactionItem.findMany({
    where: { transaction: { runId, status: { in: ["REAUTHORIZATION_REQUIRED", "EXPIRED", "FAILED"] } } },
    select: { recipientId: true },
  });
  return [...new Set(items.map((i) => i.recipientId))];
}

export type RunView = ReturnType<typeof serializeRun>;

export function serializeRun(
  run: DistributionRun & {
    transactions: {
      chunkIndex: number;
      status: string;
      channelPublicKey: string;
      transactionHash: string;
      stellarTxHash: string | null;
      errorCode: string | null;
      submittedAt: Date | null;
      confirmedAt: Date | null;
      _count: { items: number };
    }[];
  },
  recipientCounts: Record<string, number>
) {
  const end = run.completedAt ?? (isTerminalRun(run.status) ? run.updatedAt : new Date());
  return {
    id: run.id,
    batchId: run.batchId,
    purpose: run.purpose,
    status: run.status,
    network: run.network,
    sourceAccount: run.sourceAccount,
    setup: {
      hash: run.setupHash,
      txHash: run.setupTxHash,
      submittedAt: run.setupSubmittedAt,
      confirmedAt: run.setupConfirmedAt,
      expiresAt: run.setupMaxTime,
    },
    signedAt: run.signedAt,
    completedAt: run.completedAt,
    elapsedMs: run.signedAt ? end.getTime() - run.signedAt.getTime() : null,
    errorCode: run.errorCode,
    errorMessage: run.errorMessage,
    cleanupRequired: run.errorCode === "CLEANUP_REQUIRED",
    terminal: isTerminalRun(run.status),
    transactions: [...run.transactions]
      .sort((a, b) => a.chunkIndex - b.chunkIndex)
      .map((t) => ({
        chunkIndex: t.chunkIndex,
        status: t.status,
        channel: t.channelPublicKey,
        operationCount: t._count.items,
        hash: t.stellarTxHash ?? t.transactionHash,
        innerHash: t.transactionHash,
        errorCode: t.errorCode,
        submittedAt: t.submittedAt,
        confirmedAt: t.confirmedAt,
      })),
    recipients: {
      total: Object.values(recipientCounts).reduce((a, b) => a + b, 0),
      succeeded: recipientCounts.SUCCESS ?? 0,
      failed: (recipientCounts.FAILED ?? 0) + (recipientCounts.REAUTHORIZATION_REQUIRED ?? 0) + (recipientCounts.EXPIRED ?? 0),
      pending: (recipientCounts.PREPARED ?? 0) + (recipientCounts.SUBMITTING ?? 0),
    },
  };
}

export async function loadRunView(runId: string) {
  const run = await prisma.distributionRun.findUniqueOrThrow({
    where: { id: runId },
    include: {
      transactions: {
        select: {
          chunkIndex: true,
          status: true,
          channelPublicKey: true,
          transactionHash: true,
          stellarTxHash: true,
          errorCode: true,
          submittedAt: true,
          confirmedAt: true,
          _count: { select: { items: true } },
        },
      },
    },
  });
  const grouped = await prisma.channelTransactionItem.groupBy({
    by: ["status"],
    where: { transaction: { runId } },
    _count: { _all: true },
  });
  return serializeRun(run, Object.fromEntries(grouped.map((g) => [g.status, g._count._all])));
}
