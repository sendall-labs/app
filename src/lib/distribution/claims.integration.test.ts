import { afterAll, describe, expect, it, vi } from "vitest";
import { Operation } from "@stellar/stellar-sdk";
import { prisma } from "@/lib/db/prisma";
import type { DistributionOp } from "./buildChunks";
import { authorizeRun, prepareRun } from "./engine";
import { driveToEnd, fundedAccount, randomKeys, seedBatch, signLikeWallet, submitAs, TESTNET } from "./testSupport";

const session = vi.hoisted(() => ({ publicKey: "" }));
vi.mock("@/lib/auth/batchAccess", async (orig) => ({
  ...(await orig<typeof import("@/lib/auth/batchAccess")>()),
  resolveBatchAccess: async () => ({ publicKey: session.publicKey, anonId: null }),
}));
const { POST: syncRoute } = await import("@/app/api/batches/[batchId]/claims/sync/route");

async function sendClaimables(sender: Awaited<ReturnType<typeof fundedAccount>>, destinations: string[], expiresAt: Date) {
  const batch = await seedBatch(sender.publicKey(), destinations, "CLAIMABLE_BALANCE", "3", { claimExpiresAt: expiresAt });
  const ops: DistributionOp[] = batch.recipients.map((r) => ({ kind: "createClaimableBalance", recipientId: r.id, destination: r.destination, amount: "3" }));
  const prepared = await prepareRun({
    batchId: batch.id,
    network: TESTNET,
    sourceAccount: sender.publicKey(),
    idempotencyKey: `claims-${batch.id}`,
    asset: null,
    ops,
    claimExpiresAt: expiresAt,
  });
  await authorizeRun(prepared.runId, signLikeWallet(prepared.setupXdr, sender));
  expect((await driveToEnd(prepared.runId)).status).toBe("COMPLETED");
  return prisma.recipient.findMany({ where: { batchId: batch.id }, orderBy: { rowIndex: "asc" } });
}

const sync = async (batchId: string) => (await (await syncRoute(new Request("http://test", { method: "POST" }), { params: Promise.resolve({ batchId }) })).json()).claims;

describe.skipIf(!!process.env.CI)("claim status sync (Testnet)", () => {
  const batchIds: string[] = [];
  afterAll(() => prisma.batch.deleteMany({ where: { id: { in: batchIds } } }));

  it("tells claimed from waiting, and reclaimed after the window closes", async () => {
    const sender = await fundedAccount();
    session.publicKey = sender.publicKey();
    const claimer = await fundedAccount();

    // Batch A: one recipient claims, one does not.
    const a = await sendClaimables(sender, [claimer.publicKey(), ...randomKeys(1)], new Date(Date.now() + 86_400_000));
    batchIds.push(a[0].batchId);
    await submitAs(claimer, (b) => b.addOperation(Operation.claimClaimableBalance({ balanceId: a[0].claimableBalanceId! })));
    const claimsA = await sync(a[0].batchId);
    expect(claimsA).toMatchObject({ created: 2, claimed: 1, unclaimed: 1, reclaimed: 0 });
    const rowsA = await prisma.recipient.findMany({ where: { batchId: a[0].batchId }, orderBy: { rowIndex: "asc" } });
    expect(rowsA[0]).toMatchObject({ claimStatus: "CLAIMED" });
    expect(rowsA[0].claimTxHash).toMatch(/^[0-9a-f]{64}$/);
    expect(rowsA[0].claimedAt).toBeInstanceOf(Date);
    expect(rowsA[1].claimStatus).toBe("UNCLAIMED");

    // Batch B: a short window; once it closes the sender takes it back.
    const deadline = new Date(Date.now() + 45_000);
    const b = await sendClaimables(sender, randomKeys(1), deadline);
    batchIds.push(b[0].batchId);
    await new Promise((r) => setTimeout(r, Math.max(0, deadline.getTime() - Date.now()) + 8_000));
    await submitAs(sender, (tx) => tx.addOperation(Operation.claimClaimableBalance({ balanceId: b[0].claimableBalanceId! })));
    expect(await sync(b[0].batchId)).toMatchObject({ created: 1, reclaimed: 1, claimed: 0, unclaimed: 0 });
    expect((await prisma.recipient.findFirstOrThrow({ where: { batchId: b[0].batchId } })).claimStatus).toBe("RECLAIMED");
  }, 300_000);

  it("refuses payment batches", async () => {
    const owner = await fundedAccount();
    session.publicKey = owner.publicKey();
    const batch = await seedBatch(owner.publicKey(), randomKeys(1));
    batchIds.push(batch.id);
    const res = await syncRoute(new Request("http://test", { method: "POST" }), { params: Promise.resolve({ batchId: batch.id }) });
    expect(res.status).toBe(400);
  });
});
