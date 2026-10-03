import { afterAll, describe, expect, it } from "vitest";
import { prisma } from "@/lib/db/prisma";
import { getHorizonServer } from "@/lib/stellar/client";
import type { DistributionOp } from "./buildChunks";
import { authorizeRun, cancelRun, prepareRun } from "./engine";
import { prepareReclaim } from "./reclaim";
import { loadAccountFunds, toStroops } from "./reserve";
import { driveToEnd, fundedAccount, randomKeys, seedBatch, signLikeWallet, TESTNET } from "./testSupport";

describe.skipIf(!!process.env.CI)("reclaim through the channel engine (Testnet)", () => {
  const batchIds: string[] = [];
  afterAll(() => prisma.batch.deleteMany({ where: { id: { in: batchIds } } }));

  it("waits for the window, then takes every unclaimed balance back with one signature", async () => {
    const sender = await fundedAccount();
    const deadline = new Date(Date.now() + 50_000);
    const batch = await seedBatch(sender.publicKey(), randomKeys(3), "CLAIMABLE_BALANCE", "4", { claimExpiresAt: deadline });
    batchIds.push(batch.id);
    const ops: DistributionOp[] = batch.recipients.map((r) => ({ kind: "createClaimableBalance", recipientId: r.id, destination: r.destination, amount: "4" }));
    const sent = await prepareRun({ batchId: batch.id, network: TESTNET, sourceAccount: sender.publicKey(), idempotencyKey: `rc-send-${batch.id}`, asset: null, ops, claimExpiresAt: deadline });
    await authorizeRun(sent.runId, signLikeWallet(sent.setupXdr, sender));
    expect((await driveToEnd(sent.runId)).status).toBe("COMPLETED");

    // Too early: the network would refuse, so Sendall does too.
    await expect(prepareReclaim(batch.id, sender.publicKey(), "too-early-1")).rejects.toMatchObject({ code: "PREFLIGHT_FAILED" });

    await new Promise((r) => setTimeout(r, Math.max(0, deadline.getTime() - Date.now()) + 8_000));
    const base = BigInt(5_000_000);
    const before = await loadAccountFunds(TESTNET, sender.publicKey(), base, null);

    // Cancelling a prepared reclaim leaves the rows untouched.
    const dry = await prepareReclaim(batch.id, sender.publicKey(), "cancel-me-1");
    await cancelRun(dry.runId);
    expect((await prisma.recipient.findMany({ where: { batchId: batch.id } })).every((r) => r.status === "SUCCESS" && r.claimStatus === "UNCLAIMED")).toBe(true);

    const reclaim = await prepareReclaim(batch.id, sender.publicKey(), "reclaim-1");
    expect(reclaim.count).toBe(3);
    await authorizeRun(reclaim.runId, signLikeWallet(reclaim.setupXdr, sender));
    expect((await driveToEnd(reclaim.runId)).status).toBe("COMPLETED");

    const rows = await prisma.recipient.findMany({ where: { batchId: batch.id } });
    expect(rows.every((r) => r.claimStatus === "RECLAIMED" && r.claimTxHash)).toBe(true);
    for (const r of rows) {
      await expect(getHorizonServer(TESTNET).claimableBalances().claimableBalance(r.claimableBalanceId!).call()).rejects.toMatchObject({ response: { status: 404 } });
    }
    // 12 XLM of amounts and 3 XLM of reserve came back, with no fee to the sender.
    const after = await loadAccountFunds(TESTNET, sender.publicKey(), base, null);
    expect(after.spendableNative - before.spendableNative).toBe(toStroops("15"));
    await expect(prepareReclaim(batch.id, sender.publicKey(), "again-1")).rejects.toMatchObject({ message: "Nothing left to reclaim." });
  }, 300_000);
});
