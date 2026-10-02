import { afterAll, describe, expect, it } from "vitest";
import { Keypair, TransactionBuilder, type Transaction } from "@stellar/stellar-sdk";
import { prisma } from "@/lib/db/prisma";
import { getHorizonServer, getNetworkPassphrase, NETWORK_CONFIG } from "@/lib/stellar/client";
import type { DistributionOp } from "./buildChunks";
import { advanceRun, authorizeRun, prepareRun } from "./engine";

const network = "TESTNET" as const;

async function fundedUser() {
  const kp = Keypair.random();
  expect((await fetch(`${NETWORK_CONFIG.TESTNET.friendbot}?addr=${kp.publicKey()}`)).ok).toBe(true);
  return kp;
}

// Batch + recipient rows the run's items point at.
async function seedBatch(user: string, n: number) {
  const batch = await prisma.batch.create({
    data: {
      network,
      ownerPublicKey: user,
      sourceAccount: user,
      status: "READY",
      recipients: {
        create: Array.from({ length: n }, (_, i) => ({
          rowIndex: i,
          destination: Keypair.random().publicKey(),
          amount: "1",
          addressValid: true,
          status: "READY" as const,
        })),
      },
    },
    include: { recipients: { orderBy: { rowIndex: "asc" } } },
  });
  return batch;
}

function signLikeWallet(setupXdr: string, user: Keypair) {
  const tx = TransactionBuilder.fromXDR(setupXdr, getNetworkPassphrase(network)) as Transaction;
  tx.sign(user);
  return tx.toXDR();
}

describe.skipIf(!!process.env.CI)("channel engine (Testnet)", () => {
  const batchIds: string[] = [];
  afterAll(async () => {
    await prisma.batch.deleteMany({ where: { id: { in: batchIds } } });
  });

  it("sends 150 new-account payments in 2 parallel chunks behind one signature", async () => {
    const user = await fundedUser();
    const batch = await seedBatch(user.publicKey(), 150);
    batchIds.push(batch.id);
    const ops: DistributionOp[] = batch.recipients.map((r) => ({
      kind: "createAccount",
      recipientId: r.id,
      destination: r.destination,
      amount: "1",
    }));
    const key = `it-${batch.id}`;

    const prepared = await prepareRun({ batchId: batch.id, network, sourceAccount: user.publicKey(), idempotencyKey: key, asset: null, ops });
    expect(prepared.transactionCount).toBe(2);
    // Same key, same run: no second setup.
    const again = await prepareRun({ batchId: batch.id, network, sourceAccount: user.publicKey(), idempotencyKey: key, asset: null, ops });
    expect(again).toMatchObject({ runId: prepared.runId, setupXdr: prepared.setupXdr });

    const signed = signLikeWallet(prepared.setupXdr, user);
    const authorized = await authorizeRun(prepared.runId, signed);
    expect(authorized.status).toBe("SETUP_SUBMITTED");
    expect((await authorizeRun(prepared.runId, signed)).setupFeeBumpXdr).toBe(authorized.setupFeeBumpXdr);

    let run = await advanceRun(prepared.runId);
    for (let i = 0; i < 5 && run.status !== "COMPLETED"; i++) run = await advanceRun(prepared.runId);
    expect(run.status).toBe("COMPLETED");

    const chunks = await prisma.channelTransaction.findMany({ where: { runId: run.id }, orderBy: { chunkIndex: "asc" } });
    expect(chunks.map((c) => c.status)).toEqual(["SUCCESS", "SUCCESS"]);
    expect(new Set(chunks.map((c) => c.channelPublicKey)).size).toBe(2);
    expect(chunks.every((c) => c.attemptCount === 1)).toBe(true);

    const account = await getHorizonServer(network).loadAccount(user.publicKey());
    expect(account.signers.filter((s) => s.type === "preauth_tx")).toHaveLength(0);
    expect(account.num_sponsored).toBe(0);
    const native = Number(account.balances.find((b) => b.asset_type === "native")!.balance);
    // The sender pays exactly the amounts: the sponsor covered every fee
    // and every signer reserve.
    expect(native).toBe(10_000 - 150);

    // Driving a finished run again changes nothing.
    expect((await advanceRun(run.id)).status).toBe("COMPLETED");
    const channels = await prisma.channelAccount.findMany({ where: { publicKey: { in: chunks.map((c) => c.channelPublicKey) } } });
    expect(channels.every((c) => c.status === "AVAILABLE")).toBe(true);
  }, 240_000);
});
