import { createHash } from "node:crypto";
import { Account, BASE_FEE, Operation, TransactionBuilder } from "@stellar/stellar-sdk";
import type { DistributionRun } from "@/generated/prisma/client";
import type { Network } from "@/generated/prisma/enums";
import { prisma } from "@/lib/db/prisma";
import { getNetworkPassphrase, getRpcServer } from "@/lib/stellar/client";
import { getSponsorKeypair } from "@/lib/stellar/serviceAccounts";
import { SETUP_TTL_SECONDS } from "./buildSetup";
import { advanceRun, isTerminalRun } from "./engine";
import { DistributionError } from "./errors";
import { checkRunSigners } from "./reconcile";

/** Sender-sourced tx that sets each leftover preAuthTx signer's weight to 0, removing it. */
export function buildRemoval(params: {
  network: Network;
  sourceAccount: string;
  sourceSequence: string;
  hashes: string[];
  maxTime: Date;
}) {
  const builder = new TransactionBuilder(new Account(params.sourceAccount, params.sourceSequence), {
    fee: BASE_FEE,
    networkPassphrase: getNetworkPassphrase(params.network),
    timebounds: { minTime: 0, maxTime: Math.floor(params.maxTime.getTime() / 1000) },
  });
  for (const hash of params.hashes) {
    builder.addOperation(
      Operation.setOptions({ source: params.sourceAccount, signer: { preAuthTx: Buffer.from(hash, "hex"), weight: 0 } })
    );
  }
  const tx = builder.build();
  return { xdr: tx.toXDR(), hash: tx.hash().toString("hex") };
}

/**
 * Runs that cannot make progress on their own: still mid-flight with no
 * live worker. advanceRun moves them on (expiring chunks whose window has
 * passed), which in turn flags any leftover signers for cleanup.
 */
export async function sweepStaleRuns(now = new Date()): Promise<DistributionRun[]> {
  const stale = await prisma.distributionRun.findMany({
    where: {
      status: { in: ["AWAITING_USER_SIGNATURE", "SETUP_SUBMITTED", "SETUP_CONFIRMED", "PAYMENTS_SUBMITTING"] },
      updatedAt: { lt: new Date(now.getTime() - 60_000) },
      OR: [{ leaseUntil: null }, { leaseUntil: { lt: now } }],
    },
    select: { id: true },
  });
  const advanced: DistributionRun[] = [];
  for (const { id } of stale) advanced.push(await advanceRun(id));
  return advanced;
}

export type CleanupPlan = { cleanupRunId: string; setupXdr: string; signerCount: number } | null;

/**
 * Prepares the exceptional extra signature: removes this run's preAuthTx
 * signers that are still on the sender (chunks that never applied).
 * Returns null when nothing is left, clearing the flag. The same set of
 * leftovers always maps to the same cleanup run.
 */
export async function prepareCleanup(runId: string): Promise<CleanupPlan> {
  const run = await prisma.distributionRun.findUniqueOrThrow({ where: { id: runId }, include: { transactions: true } });
  if (run.purpose === "CLEANUP") throw new DistributionError("INVALID_STATE", "A cleanup run cannot be cleaned up.");
  if (!isTerminalRun(run.status)) throw new DistributionError("INVALID_STATE", "The distribution is still running.");

  const own = run.transactions.map((t) => t.transactionHash);
  const { leftoverHashes } = await checkRunSigners(run.network, run.sourceAccount, own, 1);
  if (leftoverHashes.length === 0) {
    if (run.errorCode === "CLEANUP_REQUIRED") {
      await prisma.distributionRun.update({ where: { id: runId }, data: { errorCode: null, errorMessage: null } });
    }
    return null;
  }

  const sorted = [...leftoverHashes].sort();
  const key = `cleanup:${runId}:${createHash("sha256").update(sorted.join(",")).digest("hex").slice(0, 16)}`;
  const existing = await prisma.distributionRun.findUnique({ where: { idempotencyKey: key } });
  if (existing?.setupXdr && existing.status === "AWAITING_USER_SIGNATURE" && existing.setupMaxTime! > new Date()) {
    return { cleanupRunId: existing.id, setupXdr: existing.setupXdr, signerCount: sorted.length };
  }

  const account = await getRpcServer(run.network).getAccount(run.sourceAccount);
  const maxTime = new Date(Date.now() + SETUP_TTL_SECONDS * 1000);
  const removal = buildRemoval({ network: run.network, sourceAccount: run.sourceAccount, sourceSequence: account.sequenceNumber(), hashes: sorted, maxTime });
  const data = {
    status: "AWAITING_USER_SIGNATURE" as const,
    setupXdr: removal.xdr,
    setupHash: removal.hash,
    setupMaxTime: maxTime,
    setupSignedXdr: null,
    setupFeeBumpXdr: null,
    setupTxHash: null,
    errorCode: null,
    errorMessage: null,
  };
  const cleanup = existing
    ? await prisma.distributionRun.update({ where: { id: existing.id }, data })
    : await prisma.distributionRun.create({
        data: {
          ...data,
          batchId: run.batchId,
          purpose: "CLEANUP",
          parentRunId: run.id,
          idempotencyKey: key,
          network: run.network,
          sourceAccount: run.sourceAccount,
          sponsorAccount: getSponsorKeypair(run.network).publicKey(),
          preAuthWeight: 0,
        },
      });
  return { cleanupRunId: cleanup.id, setupXdr: removal.xdr, signerCount: sorted.length };
}
