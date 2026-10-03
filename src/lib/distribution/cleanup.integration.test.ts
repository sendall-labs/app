import { afterAll, describe, expect, it } from "vitest";
import { Keypair, Operation, TransactionBuilder } from "@stellar/stellar-sdk";
import { prisma } from "@/lib/db/prisma";
import { getHorizonServer, getNetworkPassphrase, getRpcServer } from "@/lib/stellar/client";
import { submitAndPoll } from "@/lib/stellar/submit";
import type { DistributionOp } from "./buildChunks";
import { channelKeypair, releaseChannels } from "./channelPool";
import { prepareCleanup, sweepStaleRuns } from "./cleanup";
import { advanceRun, authorizeRun, prepareRun } from "./engine";
import { driveToEnd, fundedAccount, seedBatch, signLikeWallet, TESTNET } from "./testSupport";

// Moves a channel's sequence behind the engine's back, the way an
// operator mistake or a bug elsewhere could.
async function bumpChannelSequence(publicKey: string) {
  const row = await prisma.channelAccount.findUniqueOrThrow({ where: { publicKey } });
  const account = await getRpcServer(TESTNET).getAccount(publicKey);
  const tx = new TransactionBuilder(account, { fee: "100", networkPassphrase: getNetworkPassphrase(TESTNET) })
    .addOperation(Operation.bumpSequence({ bumpTo: (BigInt(account.sequenceNumber()) + BigInt(5)).toString() }))
    .setTimeout(60)
    .build();
  tx.sign(channelKeypair(row));
  expect((await submitAndPoll(TESTNET, tx.toXDR())).status).toBe("SUCCESS");
  return row.id;
}

describe.skipIf(!!process.env.CI)("stale signers and cleanup (Testnet)", () => {
  const batchIds: string[] = [];
  const channelIds: string[] = [];
  afterAll(async () => {
    await prisma.batch.deleteMany({ where: { id: { in: batchIds } } });
    // Nothing authorized is pending on these any more.
    await releaseChannels(channelIds);
  });

  it("fails safely on channel drift, flags the leftover signer, and removes it with one more signature", async () => {
    const user = await fundedAccount();
    const batch = await seedBatch(user.publicKey(), [Keypair.random().publicKey(), Keypair.random().publicKey()]);
    batchIds.push(batch.id);
    const ops: DistributionOp[] = batch.recipients.map((r) => ({ kind: "createAccount", recipientId: r.id, destination: r.destination, amount: "1" }));

    const prepared = await prepareRun({ batchId: batch.id, network: TESTNET, sourceAccount: user.publicKey(), idempotencyKey: `cl-${batch.id}`, asset: null, ops });
    const [chunk] = await prisma.channelTransaction.findMany({ where: { runId: prepared.runId } });
    channelIds.push(await bumpChannelSequence(chunk.channelPublicKey));

    await authorizeRun(prepared.runId, signLikeWallet(prepared.setupXdr, user));
    const run = await driveToEnd(prepared.runId);
    expect(run.status).toBe("FAILED");
    expect(run.errorCode).toBe("CLEANUP_REQUIRED");

    const after = await prisma.channelTransaction.findUniqueOrThrow({ where: { id: chunk.id } });
    expect(after).toMatchObject({ status: "EXPIRED", errorCode: "CHANNEL_SEQUENCE_CHANGED", attemptCount: 0, feeBumpXdr: null });
    expect(after.unsignedInnerXdr).toBe(chunk.unsignedInnerXdr); // never rebuilt
    expect((await prisma.channelAccount.findUniqueOrThrow({ where: { publicKey: chunk.channelPublicKey } })).status).toBe("QUARANTINED");
    const rows = await prisma.recipient.findMany({ where: { batchId: batch.id } });
    expect(rows.every((r) => r.status === "FAILED")).toBe(true);

    const horizon = getHorizonServer(TESTNET);
    const stuck = await horizon.loadAccount(user.publicKey());
    expect(stuck.signers.filter((s) => s.type === "preauth_tx")).toHaveLength(1);
    expect(stuck.num_sponsored).toBe(1);

    const plan = await prepareCleanup(run.id);
    expect(plan?.signerCount).toBe(1);
    expect((await prepareCleanup(run.id))?.cleanupRunId).toBe(plan!.cleanupRunId); // idempotent

    await authorizeRun(plan!.cleanupRunId, signLikeWallet(plan!.setupXdr, user));
    expect((await advanceRun(plan!.cleanupRunId)).status).toBe("COMPLETED");

    const clean = await horizon.loadAccount(user.publicKey());
    expect(clean.signers.filter((s) => s.type === "preauth_tx")).toHaveLength(0);
    expect(clean.num_sponsored).toBe(0);
    expect((await prisma.distributionRun.findUniqueOrThrow({ where: { id: run.id } })).errorCode).toBeNull();
    expect(await prepareCleanup(run.id)).toBeNull();
  }, 240_000);

  it("expires an abandoned unsigned run and frees its channels", async () => {
    const user = await fundedAccount();
    const batch = await seedBatch(user.publicKey(), [Keypair.random().publicKey()]);
    batchIds.push(batch.id);
    const prepared = await prepareRun({
      batchId: batch.id,
      network: TESTNET,
      sourceAccount: user.publicKey(),
      idempotencyKey: `abandon-${batch.id}`,
      asset: null,
      ops: [{ kind: "createAccount", recipientId: batch.recipients[0].id, destination: batch.recipients[0].destination, amount: "1" }],
    });
    // The wallet never answered and nobody polled for a while.
    await prisma.$executeRaw`UPDATE "DistributionRun" SET "setupMaxTime" = now() - interval '1 minute', "updatedAt" = now() - interval '5 minutes' WHERE "id" = ${prepared.runId}`;

    const swept = await sweepStaleRuns();
    expect(swept.find((r) => r.id === prepared.runId)?.status).toBe("EXPIRED");
    const [chunk] = await prisma.channelTransaction.findMany({ where: { runId: prepared.runId } });
    expect(chunk).toMatchObject({ status: "EXPIRED", errorCode: "SETUP_EXPIRED" });
    expect((await prisma.channelAccount.findUniqueOrThrow({ where: { publicKey: chunk.channelPublicKey } })).status).toBe("AVAILABLE");
    // Nothing was ever installed, so there is nothing to clean up.
    expect(await prepareCleanup(prepared.runId)).toBeNull();
  }, 120_000);
});
