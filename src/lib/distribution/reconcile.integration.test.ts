import { afterAll, describe, expect, it } from "vitest";
import { Keypair } from "@stellar/stellar-sdk";
import { prisma } from "@/lib/db/prisma";
import { getHorizonServer } from "@/lib/stellar/client";
import type { DistributionOp } from "./buildChunks";
import { authorizeRun, prepareRun } from "./engine";
import { checkRunSigners } from "./reconcile";
import { driveToEnd, fundedAccount, seedBatch, signLikeWallet, TESTNET } from "./testSupport";

describe.skipIf(!!process.env.CI)("reconciliation (Testnet)", () => {
  const batchIds: string[] = [];
  afterAll(() => prisma.batch.deleteMany({ where: { id: { in: batchIds } } }));

  it("maps an atomic chunk failure onto every row of that chunk only", async () => {
    const user = await fundedAccount();
    const missing = Keypair.random().publicKey(); // payment to a non-existent account fails
    const dests = [...Array.from({ length: 101 }, () => Keypair.random().publicKey()), missing];
    const batch = await seedBatch(user.publicKey(), dests);
    batchIds.push(batch.id);
    const ops: DistributionOp[] = batch.recipients.map((r) =>
      r.destination === missing
        ? { kind: "payment", recipientId: r.id, destination: r.destination, amount: "1" }
        : { kind: "createAccount", recipientId: r.id, destination: r.destination, amount: "1" }
    );

    const prepared = await prepareRun({ batchId: batch.id, network: TESTNET, sourceAccount: user.publicKey(), idempotencyKey: `rc-${batch.id}`, asset: null, ops });
    await authorizeRun(prepared.runId, signLikeWallet(prepared.setupXdr, user));
    const run = await driveToEnd(prepared.runId);
    expect(run.status).toBe("PARTIALLY_FAILED");
    expect(run.errorCode).toBeNull();

    const chunks = await prisma.channelTransaction.findMany({ where: { runId: run.id }, orderBy: { chunkIndex: "asc" } });
    expect(chunks.map((c) => c.status)).toEqual(["SUCCESS", "REAUTHORIZATION_REQUIRED"]);
    expect(chunks[1].errorCode).toBe("paymentNoDestination");

    const rows = await prisma.recipient.findMany({ where: { batchId: batch.id }, orderBy: { rowIndex: "asc" } });
    expect(rows.slice(0, 100).every((r) => r.status === "SUCCESS" && r.deliveryMethod === "CREATE_ACCOUNT")).toBe(true);
    expect(rows[100]).toMatchObject({ status: "FAILED" });
    expect(rows[100].errorMessage).toMatch(/another row in the same transaction/);
    expect(rows[101]).toMatchObject({ status: "FAILED", errorMessage: "Recipient account does not exist." });
    expect((await prisma.batch.findUniqueOrThrow({ where: { id: batch.id } })).status).toBe("PARTIAL_FAILURE");

    const signers = await checkRunSigners(TESTNET, user.publicKey(), chunks.map((c) => c.transactionHash));
    expect(signers.leftoverHashes).toEqual([]);
  }, 240_000);

  it("records claimable balance ids that exist on-chain", async () => {
    const user = await fundedAccount();
    const dests = Array.from({ length: 3 }, () => Keypair.random().publicKey());
    const batch = await seedBatch(user.publicKey(), dests, "CLAIMABLE_BALANCE", "2");
    batchIds.push(batch.id);
    const ops: DistributionOp[] = batch.recipients.map((r) => ({ kind: "createClaimableBalance", recipientId: r.id, destination: r.destination, amount: "2" }));

    const prepared = await prepareRun({
      batchId: batch.id,
      network: TESTNET,
      sourceAccount: user.publicKey(),
      idempotencyKey: `rc-cb-${batch.id}`,
      asset: null,
      ops,
      claimExpiresAt: new Date(Date.now() + 86_400_000),
    });
    await authorizeRun(prepared.runId, signLikeWallet(prepared.setupXdr, user));
    expect((await driveToEnd(prepared.runId)).status).toBe("COMPLETED");

    const rows = await prisma.recipient.findMany({ where: { batchId: batch.id }, orderBy: { rowIndex: "asc" } });
    const horizon = getHorizonServer(TESTNET);
    for (const r of rows) {
      expect(r).toMatchObject({ status: "SUCCESS", deliveryMethod: "CLAIMABLE_BALANCE", claimStatus: "UNCLAIMED" });
      expect(r.claimableBalanceId).toMatch(/^00000000[0-9a-f]{64}$/);
      const onChain = await horizon.claimableBalances().claimableBalance(r.claimableBalanceId!).call();
      expect(onChain.claimants.map((c) => c.destination).sort()).toEqual([r.destination, user.publicKey()].sort());
      expect(onChain.amount).toBe("2.0000000");
    }
  }, 240_000);
});
