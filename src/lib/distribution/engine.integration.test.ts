// The nine required scenarios for the channel engine, against Testnet and
// the local database, through the same entry point the API uses.
import { afterAll, describe, expect, it } from "vitest";
import { Asset, Keypair, Operation, TransactionBuilder, type Transaction } from "@stellar/stellar-sdk";
import { prisma } from "@/lib/db/prisma";
import { getHorizonServer, getNetworkPassphrase, getRpcServer } from "@/lib/stellar/client";
import { prepareBatchRun } from "./batchRuns";
import { channelKeypair, releaseChannels } from "./channelPool";
import { advanceRun, authorizeRun } from "./engine";
import { DistributionError } from "./errors";
import { submitPersisted } from "./feeBump";
import { driveToEnd, fundedAccount, randomKeys, seedBatch, signLikeWallet, submitAs, TESTNET } from "./testSupport";

const batchIds: string[] = [];
const quarantined: string[] = [];

async function newAccountBatch(user: Keypair, n: number) {
  const batch = await seedBatch(user.publicKey(), randomKeys(n), "PAYMENT", "1", { accountExists: false });
  batchIds.push(batch.id);
  return prisma.batch.findUniqueOrThrow({ where: { id: batch.id }, include: { recipients: true } });
}

function setupOpCount(setupXdr: string) {
  return (TransactionBuilder.fromXDR(setupXdr, getNetworkPassphrase(TESTNET)) as Transaction).operations.length;
}

async function chunksOf(runId: string) {
  return prisma.channelTransaction.findMany({ where: { runId }, orderBy: { chunkIndex: "asc" } });
}

async function preauthSigners(account: string) {
  return (await getHorizonServer(TESTNET).loadAccount(account)).signers.filter((s) => s.type === "preauth_tx");
}

// Chunks are independent: each is on its own channel, and at least two
// were in flight at the same time instead of one waiting for the other.
// (How many fit per ledger is the network's limit; see submitWindow.)
function submittedInParallel(chunks: { submittedAt: Date | null; confirmedAt: Date | null }[]) {
  return chunks.some((a, i) =>
    chunks.some((b, j) => i !== j && a.submittedAt! < b.confirmedAt! && b.submittedAt! < a.confirmedAt!)
  );
}

async function sendAll(user: Keypair, n: number, key: string) {
  const batch = await newAccountBatch(user, n);
  const prepared = await prepareBatchRun({ batch, idempotencyKey: key });
  await authorizeRun(prepared.runId, signLikeWallet(prepared.setupXdr, user));
  const run = await driveToEnd(prepared.runId);
  return { batch, prepared, run, chunks: await chunksOf(run.id) };
}

async function codeOf(p: Promise<unknown>) {
  try {
    await p;
    return "ok";
  } catch (err) {
    if (err instanceof DistributionError) return err.code;
    throw err;
  }
}

describe.skipIf(!!process.env.CI)("channel engine: required scenarios (Testnet)", () => {
  afterAll(async () => {
    await prisma.batch.deleteMany({ where: { id: { in: batchIds } } });
    await releaseChannels(quarantined);
  });

  it("1. 100 recipients: one setup signature, one channel, one transaction", async () => {
    const user = await fundedAccount();
    const { prepared, run, chunks } = await sendAll(user, 100, "spec-1");
    expect(prepared.transactionCount).toBe(1);
    expect(setupOpCount(prepared.setupXdr)).toBe(3); // begin sponsoring, 1 signer, end sponsoring
    expect(run.status).toBe("COMPLETED");
    expect(chunks).toHaveLength(1);
    expect(chunks[0].status).toBe("SUCCESS");
    expect(await preauthSigners(user.publicKey())).toHaveLength(0);
  }, 180_000);

  it("2. 300 recipients: 3 transactions on 3 channels, submitted independently", async () => {
    const user = await fundedAccount();
    const { run, chunks } = await sendAll(user, 300, "spec-2");
    expect(run.status).toBe("COMPLETED");
    expect(chunks.map((c) => c.status)).toEqual(["SUCCESS", "SUCCESS", "SUCCESS"]);
    expect(new Set(chunks.map((c) => c.channelPublicKey)).size).toBe(3);
    expect(submittedInParallel(chunks)).toBe(true);
  }, 240_000);

  it("3. 1,000 recipients: 10 transactions, one setup signature, parallel submission", async () => {
    const user = await fundedAccount();
    const { prepared, run, chunks } = await sendAll(user, 1000, "spec-3");
    console.table(chunks.map((c) => ({ i: c.chunkIndex, status: c.status, attempts: c.attemptCount, error: c.errorCode, submitted: c.submittedAt?.toISOString().slice(11, 23), confirmed: c.confirmedAt?.toISOString().slice(11, 23) })));
    expect(setupOpCount(prepared.setupXdr)).toBe(12);
    expect(run.status).toBe("COMPLETED");
    expect(chunks).toHaveLength(10);
    // Under congestion a chunk may need a higher fee bump; the authorized
    // inner transaction is the same every time.
    expect(chunks.every((c) => c.status === "SUCCESS" && c.attemptCount >= 1)).toBe(true);
    expect(new Set(chunks.map((c) => c.channelPublicKey)).size).toBe(10);
    expect(submittedInParallel(chunks)).toBe(true);
    const succeeded = await prisma.recipient.count({ where: { batchId: run.batchId, status: "SUCCESS" } });
    expect(succeeded).toBe(1000);
    const account = await getHorizonServer(TESTNET).loadAccount(user.publicKey());
    expect(account.signers.filter((s) => s.type === "preauth_tx")).toHaveLength(0);
    expect(account.num_sponsored).toBe(0);
    console.info(`1,000 recipients: signature to last confirmation ${run.completedAt!.getTime() - run.signedAt!.getTime()} ms`);
  }, 300_000);

  it("4. a destination without the trustline is caught before setup", async () => {
    const issuer = await fundedAccount();
    const holder = await fundedAccount();
    const stranger = await fundedAccount();
    const tst = new Asset("TST", issuer.publicKey());
    await submitAs(holder, (b) => b.addOperation(Operation.changeTrust({ asset: tst })));

    const batch = await seedBatch(issuer.publicKey(), [holder.publicKey(), stranger.publicKey()], "PAYMENT", "5", {
      assetCode: "TST",
      assetIssuer: issuer.publicKey(),
      accountExists: true,
    });
    batchIds.push(batch.id);
    const full = await prisma.batch.findUniqueOrThrow({ where: { id: batch.id }, include: { recipients: true } });

    let problems: { code: string; recipientId?: string }[] = [];
    try {
      await prepareBatchRun({ batch: full, idempotencyKey: "spec-4" });
    } catch (err) {
      expect(err).toBeInstanceOf(DistributionError);
      problems = (err as DistributionError).details!.problems as typeof problems;
    }
    const strangerRow = full.recipients.find((r) => r.destination === stranger.publicKey())!;
    expect(problems).toEqual([expect.objectContaining({ code: "DESTINATION_NOT_READY", recipientId: strangerRow.id })]);
    expect(await prisma.distributionRun.count({ where: { batchId: batch.id } })).toBe(0);
    expect((await prisma.recipient.findUniqueOrThrow({ where: { id: strangerRow.id } })).status).toBe("CHECK_FAILED");
  }, 120_000);

  it("5. a failure after authorization consumes the signer and is never rebuilt", async () => {
    const user = await fundedAccount();
    const batch = await newAccountBatch(user, 3);
    const prepared = await prepareBatchRun({ batch, idempotencyKey: "spec-5" });
    const [before] = await chunksOf(prepared.runId);
    // Someone else creates one destination after preflight passed.
    await fetch(`https://friendbot.stellar.org?addr=${batch.recipients[1].destination}`);
    await authorizeRun(prepared.runId, signLikeWallet(prepared.setupXdr, user));
    const run = await driveToEnd(prepared.runId);

    expect(run.status).toBe("FAILED");
    expect(run.errorCode).toBeNull(); // the signer was consumed, nothing to clean up
    const chunks = await chunksOf(run.id);
    expect(chunks).toHaveLength(1);
    expect(chunks[0]).toMatchObject({
      status: "REAUTHORIZATION_REQUIRED",
      errorCode: "createAccountAlreadyExist",
      attemptCount: 1,
      transactionHash: before.transactionHash,
      unsignedInnerXdr: before.unsignedInnerXdr,
    });
    expect(await preauthSigners(user.publicKey())).toHaveLength(0);
    // Driving it again builds nothing new.
    await advanceRun(run.id);
    expect(await chunksOf(run.id)).toHaveLength(1);
    expect(await prisma.distributionRun.count({ where: { batchId: batch.id } })).toBe(1);
  }, 180_000);

  it("6. a crash after setup confirmation resumes from the persisted XDRs", async () => {
    const user = await fundedAccount();
    const batch = await newAccountBatch(user, 150);
    const prepared = await prepareBatchRun({ batch, idempotencyKey: "spec-6" });
    const persisted = await chunksOf(prepared.runId);
    const authorized = await authorizeRun(prepared.runId, signLikeWallet(prepared.setupXdr, user));

    // The previous process confirmed the setup, then died holding the lease.
    expect((await submitPersisted(TESTNET, authorized.setupFeeBumpXdr!)).status).toBe("SUCCESS");
    await prisma.distributionRun.update({
      where: { id: prepared.runId },
      data: { status: "SETUP_CONFIRMED", setupConfirmedAt: new Date(), leaseOwner: "dead-process", leaseUntil: new Date(Date.now() - 1000) },
    });

    const run = await driveToEnd(prepared.runId);
    expect(run.status).toBe("COMPLETED");
    const after = await chunksOf(run.id);
    expect(after.map((c) => [c.transactionHash, c.unsignedInnerXdr])).toEqual(persisted.map((c) => [c.transactionHash, c.unsignedInnerXdr]));
    expect(after.every((c) => c.attemptCount === 1)).toBe(true);
  }, 180_000);

  it("6b. a crash after a chunk was sent finds it on-chain instead of sending again", async () => {
    const user = await fundedAccount();
    const batch = await newAccountBatch(user, 2);
    const prepared = await prepareBatchRun({ batch, idempotencyKey: "spec-6b" });
    await authorizeRun(prepared.runId, signLikeWallet(prepared.setupXdr, user));
    await driveToEnd(prepared.runId);
    const [chunk] = await chunksOf(prepared.runId);
    // Pretend the process died after sending but before recording the result.
    await prisma.channelTransaction.update({ where: { id: chunk.id }, data: { status: "SUBMITTING", confirmedAt: null } });
    await prisma.distributionRun.update({ where: { id: prepared.runId }, data: { status: "PAYMENTS_SUBMITTING", completedAt: null } });
    const run = await advanceRun(prepared.runId);
    expect(run.status).toBe("COMPLETED");
    expect(await prisma.channelTransaction.findUniqueOrThrow({ where: { id: chunk.id } })).toMatchObject({ status: "SUCCESS", attemptCount: 1 });
  }, 180_000);

  it("7. an unexpected channel sequence change fails safely without rebuilding", async () => {
    const user = await fundedAccount();
    const batch = await newAccountBatch(user, 2);
    const prepared = await prepareBatchRun({ batch, idempotencyKey: "spec-7" });
    const [chunk] = await chunksOf(prepared.runId);
    const channel = await prisma.channelAccount.findUniqueOrThrow({ where: { publicKey: chunk.channelPublicKey } });
    quarantined.push(channel.id);
    const seq = (await getRpcServer(TESTNET).getAccount(channel.publicKey)).sequenceNumber();
    await submitAs(channelKeypair(channel), (b) => b.addOperation(Operation.bumpSequence({ bumpTo: (BigInt(seq) + BigInt(3)).toString() })));

    await authorizeRun(prepared.runId, signLikeWallet(prepared.setupXdr, user));
    const run = await driveToEnd(prepared.runId);
    expect(run).toMatchObject({ status: "FAILED", errorCode: "CLEANUP_REQUIRED" });
    expect(await prisma.channelTransaction.findUniqueOrThrow({ where: { id: chunk.id } })).toMatchObject({
      status: "EXPIRED",
      errorCode: "CHANNEL_SEQUENCE_CHANGED",
      attemptCount: 0,
      unsignedInnerXdr: chunk.unsignedInnerXdr,
    });
    expect((await prisma.channelAccount.findUniqueOrThrow({ where: { id: channel.id } })).status).toBe("QUARANTINED");
  }, 180_000);

  it("8. an account without enough free signer slots is refused before signing", async () => {
    const user = await fundedAccount();
    await submitAs(user, (b) => {
      for (const key of randomKeys(15)) b.addOperation(Operation.setOptions({ signer: { ed25519PublicKey: key, weight: 1 } }));
    });
    const batch = await newAccountBatch(user, 600); // 6 chunks, 5 free slots
    expect(await codeOf(prepareBatchRun({ batch, idempotencyKey: "spec-8" }))).toBe("INSUFFICIENT_SIGNER_SLOTS");
    expect(await prisma.distributionRun.count({ where: { batchId: batch.id } })).toBe(0);
    expect(await prisma.recipient.count({ where: { batchId: batch.id, status: "READY" } })).toBe(600);
  }, 180_000);

  it("9. custom thresholds: the signer weight meets medium; one signature below high is refused", async () => {
    const strong = await fundedAccount();
    await submitAs(strong, (b) => b.addOperation(Operation.setOptions({ masterWeight: 3, lowThreshold: 1, medThreshold: 2, highThreshold: 3 })));
    const ok = await newAccountBatch(strong, 2);
    const prepared = await prepareBatchRun({ batch: ok, idempotencyKey: "spec-9a" });
    const setup = TransactionBuilder.fromXDR(prepared.setupXdr, getNetworkPassphrase(TESTNET)) as Transaction;
    const signerOp = setup.operations[1];
    expect(signerOp.type === "setOptions" && (signerOp.signer as { weight: number }).weight).toBe(2);
    await authorizeRun(prepared.runId, signLikeWallet(prepared.setupXdr, strong));
    expect((await driveToEnd(prepared.runId)).status).toBe("COMPLETED");

    const weak = await fundedAccount();
    await submitAs(weak, (b) =>
      b
        .addOperation(Operation.setOptions({ signer: { ed25519PublicKey: Keypair.random().publicKey(), weight: 1 } }))
        .addOperation(Operation.setOptions({ lowThreshold: 1, medThreshold: 1, highThreshold: 2 }))
    );
    const refused = await newAccountBatch(weak, 2);
    expect(await codeOf(prepareBatchRun({ batch: refused, idempotencyKey: "spec-9b" }))).toBe("UNSUPPORTED_MULTISIG");
  }, 180_000);
});
