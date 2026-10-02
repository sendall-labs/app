import { afterAll, describe, expect, it, vi } from "vitest";
import { Keypair, TransactionBuilder, type Transaction } from "@stellar/stellar-sdk";
import { prisma } from "@/lib/db/prisma";
import { getHorizonServer, getNetworkPassphrase } from "@/lib/stellar/client";
import { claimDeadline } from "./claimWindow";
import { prepareBatchRun } from "./batchRuns";
import { authorizeRun } from "./engine";
import { driveToEnd, fundedAccount, randomKeys, signLikeWallet, TESTNET } from "./testSupport";

const session = vi.hoisted(() => ({ publicKey: "" }));
vi.mock("@/lib/auth/batchAccess", async (orig) => ({
  ...(await orig<typeof import("@/lib/auth/batchAccess")>()),
  resolveBatchAccess: async () => ({ publicKey: session.publicKey, anonId: null }),
}));
const { PATCH } = await import("@/app/api/batches/[batchId]/route");
const patch = (batchId: string, body: unknown) =>
  PATCH(new Request("http://test", { method: "PATCH", body: JSON.stringify(body) }), { params: Promise.resolve({ batchId }) });

describe.skipIf(!!process.env.CI)("claim window (Testnet)", () => {
  const ids: string[] = [];
  afterAll(() => prisma.batch.deleteMany({ where: { id: { in: ids } } }));

  it("counts the window from sending and writes it into every predicate", async () => {
    const user = await fundedAccount();
    session.publicKey = user.publicKey();
    const batch = await prisma.batch.create({
      data: {
        network: TESTNET,
        ownerPublicKey: user.publicKey(),
        sourceAccount: user.publicKey(),
        kind: "CLAIMABLE_BALANCE",
        claimWindowDays: 30,
        status: "READY",
        recipients: { create: randomKeys(3).map((d, i) => ({ rowIndex: i + 1, destination: d, amount: "2", addressValid: true, status: "READY" as const })) },
      },
    });
    ids.push(batch.id);

    // Only the window changes; rows stay checked.
    expect((await patch(batch.id, { claimWindowDays: 7 })).status).toBe(200);
    expect((await patch(batch.id, { claimWindowDays: 14 })).status).toBe(400);
    const full = await prisma.batch.findUniqueOrThrow({ where: { id: batch.id }, include: { recipients: true } });
    expect(full.claimWindowDays).toBe(7);
    expect(full.recipients.every((r) => r.status === "READY")).toBe(true);

    const before = Date.now();
    const prepared = await prepareBatchRun({ batch: full, idempotencyKey: "window-7" });
    const deadline = prepared.claimExpiresAt!;
    expect(Math.abs(deadline.getTime() - claimDeadline(7, new Date(before)).getTime())).toBeLessThan(10_000);

    const [chunk] = await prisma.channelTransaction.findMany({ where: { runId: prepared.runId } });
    const tx = TransactionBuilder.fromXDR(chunk.unsignedInnerXdr, getNetworkPassphrase(TESTNET)) as Transaction;
    for (const op of tx.operations) {
      if (op.type !== "createClaimableBalance") throw new Error("expected claimable balances");
      expect(BigInt(op.claimants[0].predicate.absBefore().toString())).toBe(BigInt(Math.floor(deadline.getTime() / 1000)));
    }

    await authorizeRun(prepared.runId, signLikeWallet(prepared.setupXdr, user));
    expect((await driveToEnd(prepared.runId)).status).toBe("COMPLETED");
    const rows = await prisma.recipient.findMany({ where: { batchId: batch.id } });
    for (const r of rows) {
      const onChain = await getHorizonServer(TESTNET).claimableBalances().claimableBalance(r.claimableBalanceId!).call();
      const recipient = onChain.claimants.find((c) => c.destination === r.destination)!;
      expect(new Date(recipient.predicate.abs_before!).getTime()).toBe(Math.floor(deadline.getTime() / 1000) * 1000);
    }
  }, 180_000);

  it("refuses a window on a payment batch", async () => {
    const user = Keypair.random().publicKey();
    session.publicKey = user;
    const batch = await prisma.batch.create({ data: { network: TESTNET, ownerPublicKey: user, status: "VALIDATED" } });
    ids.push(batch.id);
    expect((await patch(batch.id, { claimWindowDays: 7 })).status).toBe(400);
  });
});
