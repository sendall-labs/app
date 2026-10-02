import { Asset } from "@stellar/stellar-sdk";
import type { Batch, DistributionRun, Recipient } from "@/generated/prisma/client";
import { prisma } from "@/lib/db/prisma";
import type { DistributionOp } from "./buildChunks";
import { isTerminalRun, prepareRun, type PreparedRun } from "./engine";
import { claimDeadline, DEFAULT_CLAIM_WINDOW_DAYS } from "./claimWindow";
import { DistributionError } from "./errors";
import { feeRatePerOp } from "./feeBump";
import { runPreflight, type PreflightProblem, type PreflightSummary } from "./preflight";
import { getSponsorKeypair, isSponsorConfigured } from "@/lib/stellar/serviceAccounts";

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
}): Promise<PreparedRun & { preflight?: PreflightSummary; claimExpiresAt?: Date }> {
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
  // The claim window counts from sending, so the deadline is fixed now.
  let claimExpiresAt: Date | undefined;
  if (batch.kind === "CLAIMABLE_BALANCE") {
    claimExpiresAt = claimDeadline(batch.claimWindowDays ?? DEFAULT_CLAIM_WINDOW_DAYS);
  }

  const ready = batch.recipients.filter((r) => r.status === "READY").sort((a, b) => a.rowIndex - b.rowIndex);
  if (ready.length === 0) throw new DistributionError("PREFLIGHT_FAILED", "No rows are ready to send.");

  const ops = opsForBatch(batch, ready);
  if (!isSponsorConfigured(batch.network)) {
    throw new DistributionError("SPONSOR_NOT_CONFIGURED", `Sending on ${batch.network} is not available yet.`);
  }
  let preflight: PreflightSummary;
  try {
    preflight = await runPreflight({
      network: batch.network,
      sourceAccount: batch.sourceAccount,
      sponsorAccount: getSponsorKeypair(batch.network).publicKey(),
      asset: batchAsset(batch),
      ops,
      rows: ready.map((r) => ({ recipientId: r.id, destination: r.destination, amount: r.amount.toString(), memo: r.memo })),
      feePerOp: await feeRatePerOp(batch.network),
    });
  } catch (err) {
    // Flag the rows themselves so the table shows what to fix.
    const problems = (err instanceof DistributionError ? (err.details?.problems as PreflightProblem[] | undefined) : undefined) ?? [];
    for (const p of problems.filter((p) => p.recipientId)) {
      await prisma.recipient.update({ where: { id: p.recipientId }, data: { status: "CHECK_FAILED", errorMessage: p.message } });
    }
    throw err;
  }

  const prepared = await prepareRun({
    batchId: batch.id,
    network: batch.network,
    sourceAccount: batch.sourceAccount,
    idempotencyKey: key,
    asset: batchAsset(batch),
    ops,
    claimExpiresAt,
    purpose: params.purpose ?? "SEND",
    parentRunId: params.parentRunId,
  });
  await prisma.recipient.updateMany({ where: { id: { in: ready.map((r) => r.id) } }, data: { status: "IN_TRANSACTION", errorMessage: null } });
  await prisma.batch.update({ where: { id: batch.id }, data: { status: "SUBMITTING", ...(claimExpiresAt ? { claimExpiresAt } : {}) } });
  return { ...prepared, preflight, claimExpiresAt };
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
  }
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
    // Only the sender's signature can make this setup do anything, so it
    // is safe to hand back while it waits for one (e.g. after a reload).
    setupXdr: run.status === "AWAITING_USER_SIGNATURE" ? run.setupXdr : null,
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
    // Counted from the transactions themselves (a transaction is atomic,
    // so all its rows share its outcome); this always agrees with the
    // lanes, even in the moment before rows are reconciled.
    recipients: (() => {
      let succeeded = 0;
      let failed = 0;
      let pending = 0;
      for (const t of run.transactions) {
        const n = t._count.items;
        if (t.status === "SUCCESS") succeeded += n;
        else if (["FAILED", "REAUTHORIZATION_REQUIRED", "EXPIRED"].includes(t.status)) failed += n;
        else pending += n;
      }
      return { total: succeeded + failed + pending, succeeded, failed, pending };
    })(),
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
  return serializeRun(run);
}
