import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { Keypair } from "@stellar/stellar-sdk";
import { prisma } from "@/lib/db/prisma";
import { fundedAccount, seedBatch, signLikeWallet } from "./testSupport";

// Route handlers read the session cookie and schedule background work
// with after(). Here the session is a fixed wallet and after() work is
// collected so the test can await it, as the server would.
const session = vi.hoisted(() => ({ publicKey: null as string | null }));
const background = vi.hoisted(() => [] as Promise<unknown>[]);
vi.mock("@/lib/auth/batchAccess", async (orig) => ({
  ...(await orig<typeof import("@/lib/auth/batchAccess")>()),
  resolveBatchAccess: async () => ({ publicKey: session.publicKey, anonId: null }),
}));
vi.mock("next/server", async (orig) => ({
  ...(await orig<typeof import("next/server")>()),
  after: (fn: () => Promise<unknown>) => background.push(fn()),
}));

const { POST: prepareRoute } = await import("@/app/api/batches/[batchId]/runs/route");
const { POST: authorizeRoute } = await import("@/app/api/runs/[runId]/authorize/route");
const { GET: statusRoute } = await import("@/app/api/runs/[runId]/route");
const { POST: cleanupRoute } = await import("@/app/api/runs/[runId]/cleanup/route");
const { POST: reauthorizeRoute } = await import("@/app/api/runs/[runId]/reauthorize/route");

const json = (body: unknown) => new Request("http://test", { method: "POST", body: JSON.stringify(body) });
const ctx = <T extends object>(p: T) => ({ params: Promise.resolve(p) });
const flush = async () => {
  while (background.length) await background.shift();
};

describe.skipIf(!!process.env.CI)("run API routes (Testnet)", () => {
  const batchIds: string[] = [];
  beforeEach(() => {
    background.length = 0;
  });
  afterAll(() => prisma.batch.deleteMany({ where: { id: { in: batchIds } } }));

  it("prepares, authorizes and reports a run; reauthorizes the failed rows", async () => {
    const user = await fundedAccount();
    session.publicKey = user.publicKey();
    const missing = Keypair.random().publicKey();
    const batch = await seedBatch(user.publicKey(), [Keypair.random().publicKey(), missing]);
    batchIds.push(batch.id);
    // First row is a new account (createAccount); the second will be
    // sent as a payment to an account that does not exist, and fail.
    await prisma.recipient.update({ where: { id: batch.recipients[0].id }, data: { accountExists: false } });

    const prep = await prepareRoute(json({ idempotencyKey: "route-test-1" }), ctx({ batchId: batch.id }));
    expect(prep.status).toBe(200);
    const prepared = await prep.json();
    expect(prepared).toMatchObject({ transactionCount: 1, summary: { recipientCount: 2, totalAmount: "2", asset: "XLM", network: "TESTNET", kind: "PAYMENT" } });

    // Same key: same run. Different key while one is in flight: refused.
    expect((await (await prepareRoute(json({ idempotencyKey: "route-test-1" }), ctx({ batchId: batch.id }))).json()).runId).toBe(prepared.runId);
    const busy = await prepareRoute(json({ idempotencyKey: "route-test-2" }), ctx({ batchId: batch.id }));
    expect(busy.status).toBe(409);

    const tampered = await authorizeRoute(json({ signedXdr: signLikeWallet(prepared.setupXdr, Keypair.random()) }), ctx({ runId: prepared.runId }));
    expect(tampered.status).toBe(400);
    expect((await tampered.json()).code).toBe("SETUP_MISMATCH");

    const auth = await authorizeRoute(json({ signedXdr: signLikeWallet(prepared.setupXdr, user) }), ctx({ runId: prepared.runId }));
    expect(auth.status).toBe(200);
    await flush();

    let view = (await (await statusRoute(new Request("http://test"), ctx({ runId: prepared.runId }))).json()).run;
    for (let i = 0; i < 5 && !view.terminal; i++) {
      await flush();
      view = (await (await statusRoute(new Request("http://test"), ctx({ runId: prepared.runId }))).json()).run;
    }
    expect(view).toMatchObject({ status: "FAILED", terminal: true, cleanupRequired: false, recipients: { total: 2, succeeded: 0, failed: 2 } });
    expect(view.transactions).toHaveLength(1);
    expect(view.transactions[0]).toMatchObject({ status: "REAUTHORIZATION_REQUIRED", errorCode: "paymentNoDestination", operationCount: 2 });
    expect(view.elapsedMs).toBeGreaterThan(0);

    expect(await (await cleanupRoute(json({}), ctx({ runId: prepared.runId }))).json()).toEqual({ clean: true });

    // Fix the bad row the way a sender would (send it as a new account),
    // then authorize the failed rows again.
    await prisma.recipient.update({ where: { id: batch.recipients[1].id }, data: { accountExists: false } });
    const re = await reauthorizeRoute(json({ idempotencyKey: "route-test-3" }), ctx({ runId: prepared.runId }));
    expect(re.status).toBe(200);
    const again = await re.json();
    expect(again.runId).not.toBe(prepared.runId);
    await authorizeRoute(json({ signedXdr: signLikeWallet(again.setupXdr, user) }), ctx({ runId: again.runId }));
    await flush();
    let second = (await (await statusRoute(new Request("http://test"), ctx({ runId: again.runId }))).json()).run;
    for (let i = 0; i < 5 && !second.terminal; i++) {
      await flush();
      second = (await (await statusRoute(new Request("http://test"), ctx({ runId: again.runId }))).json()).run;
    }
    expect(second).toMatchObject({ status: "COMPLETED", purpose: "REAUTHORIZE", recipients: { succeeded: 2 } });
    const rows = await prisma.recipient.findMany({ where: { batchId: batch.id } });
    expect(rows.every((r) => r.status === "SUCCESS")).toBe(true);
  }, 300_000);

  it("refuses callers who do not own the batch", async () => {
    const owner = Keypair.random().publicKey();
    const batch = await seedBatch(owner, [Keypair.random().publicKey()]);
    batchIds.push(batch.id);
    session.publicKey = Keypair.random().publicKey();
    expect((await prepareRoute(json({ idempotencyKey: "route-test-x" }), ctx({ batchId: batch.id }))).status).toBe(404);
    session.publicKey = null;
    expect((await prepareRoute(json({ idempotencyKey: "route-test-y" }), ctx({ batchId: batch.id }))).status).toBe(401);
  });
});
