import { randomUUID } from "node:crypto";
import pLimit from "p-limit";
import { Asset, TransactionBuilder, type Transaction } from "@stellar/stellar-sdk";
import type { ChannelTransaction, DistributionRun } from "@/generated/prisma/client";
import type { Network, RunPurpose } from "@/generated/prisma/enums";
import { prisma } from "@/lib/db/prisma";
import { getHorizonServer, getNetworkPassphrase, getRpcServer } from "@/lib/stellar/client";
import { MAX_OPS_PER_TX } from "@/lib/stellar/txBuilder";
import { getSponsorKeypair, isSponsorConfigured } from "@/lib/stellar/serviceAccounts";
import { loadAccountAuthority, planAuthority } from "./authority";
import { buildChunks, chunkCount, type DistributionOp } from "./buildChunks";
import { buildSetup, SETUP_TTL_SECONDS } from "./buildSetup";
import {
  channelKeypair,
  quarantineChannel,
  releaseChannels,
  reserveChannels,
} from "./channelPool";
import { DistributionError } from "./errors";
import { buildFeeBump, feeRatePerOp, submitPersisted, type SubmitOutcome } from "./feeBump";
import { checkRunSigners, reconcileChunkById, reconcileRun } from "./reconcile";
import { assertSetupShape, verifySignedSetup } from "./verifySetup";

// Chunks get a longer window than the setup so they can still land after
// the setup confirms at the very end of its own window.
export const CHUNK_TTL_SECONDS = 15 * 60;
// Channels stay reserved a little past the chunk window: after that the
// pre-authorized transaction can never apply.
const CHANNEL_GRACE_MS = 60_000;
const LEASE_MS = 90_000;
/**
 * How many chunks may be in flight at once. A ledger only takes so many
 * operations (Testnet 200, Mainnet 1,000), and stellar-core drops a
 * transaction that waits in its queue for a few ledgers, then bans it for
 * a while. Flooding the queue therefore makes a run slower, so the
 * window follows the network's per-ledger capacity in whole chunks.
 */
export async function submitWindow(network: Network): Promise<number> {
  const override = Number(process.env.SUBMIT_CONCURRENCY);
  if (override > 0) return override;
  try {
    const page = await getHorizonServer(network).ledgers().order("desc").limit(1).call();
    const capacity = Number(page.records[0].max_tx_set_size);
    return Math.max(2, Math.floor(capacity / MAX_OPS_PER_TX));
  } catch {
    return 2;
  }
}

const TERMINAL_CHUNK = new Set(["SUCCESS", "FAILED", "REAUTHORIZATION_REQUIRED", "EXPIRED"]);
const TERMINAL_RUN = new Set(["COMPLETED", "PARTIALLY_FAILED", "FAILED", "EXPIRED"]);

export type PrepareInput = {
  batchId: string;
  network: Network;
  sourceAccount: string;
  idempotencyKey: string;
  asset: Asset | null;
  ops: DistributionOp[];
  claimExpiresAt?: Date;
  purpose?: RunPurpose;
  parentRunId?: string;
  walletKey?: string;
  now?: Date;
};

export type PreparedRun = { runId: string; setupXdr: string; transactionCount: number; status: DistributionRun["status"] };

/**
 * Phase 1-3: locks channels, builds and persists the exact chunk
 * transactions and the sponsor-signed setup. Calling it again with the
 * same idempotency key returns the same run instead of building a second
 * setup.
 */
export async function prepareRun(input: PrepareInput): Promise<PreparedRun> {
  const existing = await prisma.distributionRun.findUnique({
    where: { idempotencyKey: input.idempotencyKey },
    include: { _count: { select: { transactions: true } } },
  });
  if (existing) {
    if (!existing.setupXdr) throw new DistributionError("INVALID_STATE", `Run ${existing.id} did not finish preparing (${existing.status}).`);
    return { runId: existing.id, setupXdr: existing.setupXdr, transactionCount: existing._count.transactions, status: existing.status };
  }

  const { network, sourceAccount, ops } = input;
  if (ops.length === 0) throw new DistributionError("PREFLIGHT_FAILED", "Nothing to send.");
  if (!isSponsorConfigured(network)) {
    throw new DistributionError("SPONSOR_NOT_CONFIGURED", `Sending on ${network} is not available yet.`);
  }
  const sponsor = getSponsorKeypair(network);
  const count = chunkCount(ops.length);
  const plan = planAuthority(await loadAccountAuthority(network, sourceAccount), count, input.walletKey);

  const now = input.now ?? new Date();
  const chunkMaxTime = new Date(now.getTime() + CHUNK_TTL_SECONDS * 1000);
  const setupMaxTime = new Date(now.getTime() + SETUP_TTL_SECONDS * 1000);

  const run = await prisma.distributionRun.create({
    data: {
      batchId: input.batchId,
      purpose: input.purpose ?? "SEND",
      parentRunId: input.parentRunId,
      idempotencyKey: input.idempotencyKey,
      network,
      sourceAccount,
      sponsorAccount: sponsor.publicKey(),
      preAuthWeight: plan.preAuthWeight,
    },
  });

  let channelIds: string[] = [];
  try {
    const channels = await reserveChannels({
      network,
      count,
      runId: run.id,
      expiresAt: new Date(chunkMaxTime.getTime() + CHANNEL_GRACE_MS),
    });
    channelIds = channels.map((c) => c.id);

    const chunks = buildChunks({
      network,
      sourceAccount,
      asset: input.asset,
      ops,
      channels,
      maxTime: chunkMaxTime,
      claimExpiresAt: input.claimExpiresAt,
    });

    await prisma.$transaction(async (tx) => {
      for (const chunk of chunks) {
        const row = await tx.channelTransaction.create({
          data: {
            runId: run.id,
            chunkIndex: chunk.chunkIndex,
            channelPublicKey: chunk.channelPublicKey,
            channelSequence: chunk.channelSequence,
            unsignedInnerXdr: chunk.xdr,
            transactionHash: chunk.hash,
            maxTime: chunkMaxTime,
            items: { create: chunk.items },
          },
        });
        await tx.channelAccount.update({
          where: { id: chunk.channelId },
          data: { transactionId: row.id, expectedSequence: chunk.channelSequence },
        });
      }
      await tx.distributionRun.update({ where: { id: run.id }, data: { status: "PAYMENTS_PREPARED" } });
    });

    const userAccount = await getRpcServer(network).getAccount(sourceAccount);
    const setup = buildSetup({
      network,
      sourceAccount,
      sourceSequence: userAccount.sequenceNumber(),
      sponsor,
      chunkHashes: chunks.map((c) => c.hash),
      preAuthWeight: plan.preAuthWeight,
      maxTime: setupMaxTime,
    });
    assertSetupShape(TransactionBuilder.fromXDR(setup.xdr, getNetworkPassphrase(network)) as Transaction, {
      sourceAccount,
      sponsorPublicKey: sponsor.publicKey(),
      chunkHashes: chunks.map((c) => c.hash),
      preAuthWeight: plan.preAuthWeight,
    });

    await prisma.distributionRun.update({
      where: { id: run.id },
      data: { setupXdr: setup.xdr, setupHash: setup.hash, setupMaxTime: setup.maxTime, status: "AWAITING_USER_SIGNATURE" },
    });
    return { runId: run.id, setupXdr: setup.xdr, transactionCount: chunks.length, status: "AWAITING_USER_SIGNATURE" };
  } catch (err) {
    // Nothing was authorized yet, so the channels are free to go back.
    await releaseChannels(channelIds);
    await prisma.distributionRun.update({
      where: { id: run.id },
      data: {
        status: "FAILED",
        errorCode: err instanceof DistributionError ? err.code : "PREPARE_FAILED",
        errorMessage: err instanceof Error ? err.message : String(err),
      },
    });
    throw err;
  }
}

/**
 * Phase 3: accepts the wallet-signed setup, verifies it against what was
 * persisted, wraps it in the sponsor's fee bump and records the exact
 * envelope before anything is sent. Repeating the call after it
 * succeeded is a no-op.
 */
export async function authorizeRun(runId: string, signedXdr: string, now = new Date()): Promise<DistributionRun> {
  const run = await prisma.distributionRun.findUniqueOrThrow({ where: { id: runId }, include: { transactions: true } });
  if (run.status !== "AWAITING_USER_SIGNATURE") {
    if (run.setupFeeBumpXdr) return run; // already authorized
    throw new DistributionError("INVALID_STATE", `Run is ${run.status}, not waiting for a signature.`);
  }
  if (!run.setupXdr || !run.setupHash || (run.purpose !== "CLEANUP" && !run.preAuthWeight)) {
    throw new DistributionError("INVALID_STATE", "Run has no setup.");
  }

  const sponsor = getSponsorKeypair(run.network);
  const passphrase = getNetworkPassphrase(run.network);
  let chunkHashes = [...run.transactions].sort((a, b) => a.chunkIndex - b.chunkIndex).map((t) => t.transactionHash);
  if (run.purpose === "CLEANUP") {
    // The hashes to remove are the server-built removal's own; each must
    // belong to the parent run, so a cleanup can never touch other signers.
    const persisted = TransactionBuilder.fromXDR(run.setupXdr, passphrase) as Transaction;
    chunkHashes = persisted.operations.map((op) =>
      op.type === "setOptions" ? ((op.signer as { preAuthTx?: Buffer } | undefined)?.preAuthTx?.toString("hex") ?? "") : ""
    );
    const parent = await prisma.channelTransaction.findMany({ where: { runId: run.parentRunId ?? "" }, select: { transactionHash: true } });
    const allowed = new Set(parent.map((t) => t.transactionHash));
    if (chunkHashes.some((h) => !allowed.has(h))) throw new DistributionError("SETUP_MISMATCH", "Cleanup targets a signer outside its distribution.");
  }
  const finalXdr = verifySignedSetup(
    {
      network: run.network,
      persistedXdr: run.setupXdr,
      persistedHash: run.setupHash,
      sourceAccount: run.sourceAccount,
      sponsorPublicKey: run.sponsorAccount,
      chunkHashes,
      preAuthWeight: run.preAuthWeight ?? 0,
      kind: run.purpose === "CLEANUP" ? "remove" : "install",
    },
    signedXdr,
    now
  );
  const bump = buildFeeBump({ network: run.network, sponsor, innerXdr: finalXdr, feePerOp: await feeRatePerOp(run.network) });

  const claimed = await prisma.distributionRun.updateMany({
    where: { id: runId, status: "AWAITING_USER_SIGNATURE" },
    data: {
      setupSignedXdr: finalXdr,
      setupFeeBumpXdr: bump.xdr,
      setupTxHash: bump.hash,
      signedAt: now,
      status: "SETUP_SUBMITTED",
    },
  });
  // count 0 means a concurrent authorize won; its envelope is the one
  // that counts, and the fresh read below returns it either way.
  void claimed;
  return prisma.distributionRun.findUniqueOrThrow({ where: { id: runId } });
}

async function acquireLease(runId: string): Promise<string | null> {
  const owner = randomUUID();
  const now = new Date();
  const got = await prisma.distributionRun.updateMany({
    where: { id: runId, OR: [{ leaseUntil: null }, { leaseUntil: { lt: now } }] },
    data: { leaseOwner: owner, leaseUntil: new Date(now.getTime() + LEASE_MS) },
  });
  return got.count === 1 ? owner : null;
}

async function releaseLease(runId: string, owner: string) {
  await prisma.distributionRun.updateMany({ where: { id: runId, leaseOwner: owner }, data: { leaseOwner: null, leaseUntil: null } });
}

async function setRunStatus(runId: string, from: DistributionRun["status"], data: Partial<DistributionRun>) {
  return prisma.distributionRun.updateMany({ where: { id: runId, status: from }, data });
}

/**
 * Drives a run forward from wherever it stands. Safe to call any number
 * of times from anywhere (after authorize, on every status poll, after a
 * restart): a lease keeps it to one worker, and every step resumes from
 * what is persisted rather than rebuilding anything.
 */
export async function advanceRun(runId: string): Promise<DistributionRun> {
  const owner = await acquireLease(runId);
  if (!owner) return prisma.distributionRun.findUniqueOrThrow({ where: { id: runId } });
  // A pass can outlive one lease period on a congested network; keep the
  // lease while this worker is alive so no second worker joins in.
  const heartbeat = setInterval(() => {
    prisma.distributionRun
      .updateMany({ where: { id: runId, leaseOwner: owner }, data: { leaseUntil: new Date(Date.now() + LEASE_MS) } })
      .catch(() => {});
  }, LEASE_MS / 3);
  try {
    let run = await prisma.distributionRun.findUniqueOrThrow({ where: { id: runId } });

    if (run.status === "SETUP_SUBMITTED") {
      const outcome = await submitPersisted(run.network, run.setupFeeBumpXdr!);
      if (outcome.status === "SUCCESS") {
        await setRunStatus(runId, "SETUP_SUBMITTED", { status: "SETUP_CONFIRMED", setupConfirmedAt: new Date() });
      } else if (outcome.status === "FAILED" || outcome.status === "REJECTED") {
        // The setup did not apply, so no signer was installed and no chunk
        // can ever land.
        await failRunBeforePayments(run, outcome);
      }
      run = await prisma.distributionRun.findUniqueOrThrow({ where: { id: runId } });
    }

    if (run.status === "SETUP_CONFIRMED" && run.purpose === "CLEANUP") {
      // The removal itself is the whole job.
      await setRunStatus(runId, "SETUP_CONFIRMED", { status: "COMPLETED", completedAt: new Date() });
      if (run.parentRunId) {
        const parent = await verifySignersCleared(run.parentRunId);
        if (parent.leftoverHashes.length === 0) {
          await prisma.distributionRun.updateMany({
            where: { id: run.parentRunId, errorCode: "CLEANUP_REQUIRED" },
            data: { errorCode: null, errorMessage: null },
          });
        }
      }
      run = await prisma.distributionRun.findUniqueOrThrow({ where: { id: runId } });
    }

    if (run.status === "SETUP_CONFIRMED") {
      await setRunStatus(runId, "SETUP_CONFIRMED", { status: "PAYMENTS_SUBMITTING" });
      run = await prisma.distributionRun.findUniqueOrThrow({ where: { id: runId } });
    }

    if (run.status === "PAYMENTS_SUBMITTING") {
      const chunks = await prisma.channelTransaction.findMany({ where: { runId }, orderBy: { chunkIndex: "asc" } });
      const limit = pLimit(await submitWindow(run.network));
      await Promise.all(chunks.filter((c) => !TERMINAL_CHUNK.has(c.status)).map((c) => limit(() => processChunk(run, c))));
      await finalizeIfDone(run);
      run = await prisma.distributionRun.findUniqueOrThrow({ where: { id: runId } });
    }

    if (run.status === "AWAITING_USER_SIGNATURE" && run.setupMaxTime && run.setupMaxTime < new Date()) {
      // The wallet never came back; nothing was installed on-chain.
      await setRunStatus(runId, "AWAITING_USER_SIGNATURE", { status: "EXPIRED", errorCode: "SETUP_EXPIRED", completedAt: new Date() });
      await prisma.channelTransaction.updateMany({ where: { runId }, data: { status: "EXPIRED", errorCode: "SETUP_EXPIRED" } });
      await releaseRunChannels(runId);
      await reconcileRun(runId);
      run = await prisma.distributionRun.findUniqueOrThrow({ where: { id: runId } });
    }
    return run;
  } finally {
    clearInterval(heartbeat);
    await releaseLease(runId, owner);
  }
}

async function failRunBeforePayments(run: DistributionRun, outcome: SubmitOutcome) {
  await prisma.channelTransaction.updateMany({ where: { runId: run.id }, data: { status: "FAILED", errorCode: "SETUP_FAILED" } });
  await setRunStatus(run.id, "SETUP_SUBMITTED", {
    status: "FAILED",
    errorCode: "SETUP_FAILED",
    errorMessage: `Setup ${outcome.status.toLowerCase()} (${outcome.txCode ?? "unknown"}).`,
    completedAt: new Date(),
  });
  await releaseRunChannels(run.id);
  await reconcileRun(run.id);
}

async function releaseRunChannels(runId: string) {
  const channels = await prisma.channelAccount.findMany({ where: { runId, status: { not: "QUARANTINED" } }, select: { id: true } });
  await releaseChannels(channels.map((c) => c.id));
}

const RETRY_PAUSE_MS = 2_500;
const MAX_FEE_ATTEMPTS = 12;

/**
 * Takes one chunk as far as it can go in this pass. When the network
 * pushes back (fee too low for a full ledger, queue full, not seen yet),
 * the chunk retries on its own schedule within its time bounds instead
 * of waiting for the slowest chunk of the run.
 */
async function processChunk(run: DistributionRun, chunk: ChannelTransaction) {
  let current = chunk;
  for (let round = 0; ; round++) {
    current = await stepChunk(run, current);
    if (current.status !== "PREPARED" && current.status !== "SUBMITTING") return;
    if (current.status === "PREPARED" && current.attemptCount >= MAX_FEE_ATTEMPTS) return;
    if (current.maxTime.getTime() - Date.now() < 10_000) return; // let expiry handling take over
    await new Promise((r) => setTimeout(r, RETRY_PAUSE_MS));
  }
}

async function stepChunk(run: DistributionRun, chunk: ChannelTransaction): Promise<ChannelTransaction> {
  const network = run.network;
  let current = chunk;

  if (current.status === "PREPARED") {
    if (current.maxTime < new Date()) {
      await prisma.channelTransaction.update({ where: { id: current.id }, data: { status: "EXPIRED", errorCode: "txTooLate" } });
      await reconcileChunkById(current.id);
      return prisma.channelTransaction.findUniqueOrThrow({ where: { id: current.id } });
    }
    const channel = await prisma.channelAccount.findUniqueOrThrow({ where: { publicKey: current.channelPublicKey } });
    // The authorization covers one exact sequence number. If the channel
    // moved, this transaction can never apply and must not be rebuilt.
    const onChain = BigInt((await getRpcServer(network).getAccount(channel.publicKey)).sequenceNumber());
    if (onChain + BigInt(1) !== BigInt(current.channelSequence)) {
      await prisma.channelTransaction.update({
        where: { id: current.id },
        data: { status: "EXPIRED", errorCode: "CHANNEL_SEQUENCE_CHANGED" },
      });
      await quarantineChannel(channel.id, `sequence ${onChain} != expected ${BigInt(current.channelSequence) - BigInt(1)}`);
      await reconcileChunkById(current.id);
      return prisma.channelTransaction.findUniqueOrThrow({ where: { id: current.id } });
    }

    const inner = TransactionBuilder.fromXDR(current.unsignedInnerXdr, getNetworkPassphrase(network)) as Transaction;
    if (inner.hash().toString("hex") !== current.transactionHash) {
      throw new DistributionError("INVALID_STATE", `Chunk ${current.chunkIndex} XDR no longer matches its authorized hash.`);
    }
    inner.sign(channelKeypair(channel));
    // Only the fee bump around the authorized inner transaction changes
    // between attempts; its bid escalates after each fee rejection.
    const bump = buildFeeBump({
      network,
      sponsor: getSponsorKeypair(network),
      innerXdr: inner.toXDR(),
      feePerOp: await feeRatePerOp(network, current.attemptCount),
    });
    // Persist the exact envelope before it leaves, so a crash can only
    // ever resume this envelope.
    current = await prisma.channelTransaction.update({
      where: { id: current.id },
      data: {
        feeBumpXdr: bump.xdr,
        stellarTxHash: bump.hash,
        status: "SUBMITTING",
        attemptCount: { increment: 1 },
        submittedAt: current.submittedAt ?? new Date(),
      },
    });
    await prisma.channelAccount.update({ where: { id: channel.id }, data: { status: "SUBMITTED" } });
  }

  if (current.status !== "SUBMITTING" || !current.feeBumpXdr) return current;
  const outcome = await submitPersisted(network, current.feeBumpXdr);
  await applyChunkOutcome(current, outcome);
  await reconcileChunkById(current.id);
  return prisma.channelTransaction.findUniqueOrThrow({ where: { id: current.id } });
}

const RETRYABLE_REJECTIONS = new Set(["txInsufficientFee", "TRY_AGAIN_LATER"]);

export async function applyChunkOutcome(chunk: ChannelTransaction, outcome: SubmitOutcome) {
  const channel = await prisma.channelAccount.findUnique({ where: { publicKey: chunk.channelPublicKey } });
  const firstFailedOp = outcome.perOperation.find((op) => !op.success)?.code;

  switch (outcome.status) {
    case "SUCCESS":
      await prisma.channelTransaction.update({
        where: { id: chunk.id },
        data: { status: "SUCCESS", resultXdr: outcome.resultXdr, confirmedAt: new Date(), errorCode: null },
      });
      if (channel) await releaseChannels([channel.id]);
      return;
    case "FAILED":
      // Applied and failed: the sequence and the preAuthTx signer are
      // consumed. Only a new user authorization can retry these rows.
      await prisma.channelTransaction.update({
        where: { id: chunk.id },
        data: {
          status: "REAUTHORIZATION_REQUIRED",
          resultXdr: outcome.resultXdr,
          confirmedAt: new Date(),
          errorCode: firstFailedOp ?? outcome.txCode ?? "txFailed",
        },
      });
      if (channel) await releaseChannels([channel.id]);
      return;
    case "REJECTED":
      if (outcome.txCode && RETRYABLE_REJECTIONS.has(outcome.txCode) && chunk.maxTime > new Date()) {
        // Never applied: try again later with a fresh fee bump around the
        // same authorized inner transaction.
        await prisma.channelTransaction.update({
          where: { id: chunk.id },
          data: { status: "PREPARED", feeBumpXdr: null, stellarTxHash: null, errorCode: outcome.txCode },
        });
        if (channel) await prisma.channelAccount.update({ where: { id: channel.id }, data: { status: "RESERVED" } });
        return;
      }
      // Never applied and cannot be: its signer may still sit on the
      // sender until a cleanup removes it.
      await prisma.channelTransaction.update({
        where: { id: chunk.id },
        data: { status: "EXPIRED", errorCode: outcome.txCode ?? "rejected" },
      });
      if (channel) {
        if (outcome.txCode === "txBadSeq") await quarantineChannel(channel.id, "txBadSeq on authorized chunk");
        // Otherwise leave it reserved; the sweep frees it after maxTime.
      }
      return;
    case "TIMEOUT":
      if (chunk.maxTime.getTime() + 30_000 < Date.now()) {
        // submitPersisted already looked the hash up: past its window it
        // never landed and never can.
        await prisma.channelTransaction.update({ where: { id: chunk.id }, data: { status: "EXPIRED", errorCode: "txTooLate" } });
        return;
      }
      if (channel) await prisma.channelAccount.update({ where: { id: channel.id }, data: { status: "AWAITING_CONFIRMATION" } });
      return;
  }
}

async function finalizeIfDone(run: DistributionRun) {
  const chunks = await prisma.channelTransaction.findMany({ where: { runId: run.id }, select: { status: true } });
  if (chunks.some((c) => !TERMINAL_CHUNK.has(c.status))) return;
  const ok = chunks.filter((c) => c.status === "SUCCESS").length;
  const status = ok === chunks.length ? "COMPLETED" : ok === 0 ? "FAILED" : "PARTIALLY_FAILED";
  const moved = await setRunStatus(run.id, "PAYMENTS_SUBMITTING", { status, completedAt: new Date() });
  if (moved.count === 0) return;
  await reconcileRun(run.id);
  await verifySignersCleared(run.id);
}

/**
 * After a run ends, confirms on Horizon that none of its preAuthTx
 * signers are left on the sender (applied chunks remove theirs, and the
 * sponsor's reserve goes with them). Anything left is flagged for the
 * cleanup flow rather than silently forgotten.
 */
export async function verifySignersCleared(runId: string) {
  const run = await prisma.distributionRun.findUniqueOrThrow({ where: { id: runId }, include: { transactions: { select: { transactionHash: true } } } });
  const check = await checkRunSigners(run.network, run.sourceAccount, run.transactions.map((t) => t.transactionHash));
  if (check.leftoverHashes.length > 0) {
    await prisma.distributionRun.update({
      where: { id: runId },
      data: { errorCode: "CLEANUP_REQUIRED", errorMessage: `${check.leftoverHashes.length} temporary signer(s) remain on the sender.` },
    });
  }
  return check;
}

export function isTerminalRun(status: DistributionRun["status"]) {
  return TERMINAL_RUN.has(status);
}

/**
 * The sender backed out at the review step. Nothing was signed, so the
 * run ends, its channels go straight back to the pool and its rows are
 * ready to send again. Only possible before the setup is signed.
 */
export async function cancelRun(runId: string): Promise<DistributionRun> {
  const moved = await setRunStatus(runId, "AWAITING_USER_SIGNATURE", {
    status: "EXPIRED",
    errorCode: "CANCELLED",
    errorMessage: "Cancelled before signing.",
    completedAt: new Date(),
  });
  if (moved.count === 0) {
    const run = await prisma.distributionRun.findUniqueOrThrow({ where: { id: runId } });
    if (run.errorCode === "CANCELLED") return run;
    throw new DistributionError("INVALID_STATE", `Run is ${run.status}; only an unsigned run can be cancelled.`);
  }
  await prisma.channelTransaction.updateMany({ where: { runId }, data: { status: "EXPIRED", errorCode: "CANCELLED" } });
  await releaseRunChannels(runId);
  const items = await prisma.channelTransactionItem.findMany({ where: { transaction: { runId } }, select: { recipientId: true } });
  await prisma.channelTransactionItem.updateMany({ where: { transaction: { runId } }, data: { status: "EXPIRED", resultCode: "CANCELLED" } });
  const run = await prisma.distributionRun.findUniqueOrThrow({ where: { id: runId } });
  // Only a send puts rows in flight; a cancelled reclaim leaves them as they were.
  if (run.purpose === "SEND" || run.purpose === "REAUTHORIZE") {
    await prisma.recipient.updateMany({ where: { id: { in: items.map((i) => i.recipientId) } }, data: { status: "READY", errorMessage: null } });
    await prisma.batch.update({ where: { id: run.batchId }, data: { status: "READY" } });
  }
  return run;
}
