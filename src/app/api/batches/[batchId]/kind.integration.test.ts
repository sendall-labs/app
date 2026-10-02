import { afterAll, describe, expect, it, vi } from "vitest";
import { Keypair } from "@stellar/stellar-sdk";
import { prisma } from "@/lib/db/prisma";
import { fundedAccount } from "@/lib/distribution/testSupport";
import { prepareBatchRun } from "@/lib/distribution/batchRuns";

const session = vi.hoisted(() => ({ publicKey: "" }));
vi.mock("@/lib/auth/batchAccess", async (orig) => ({
  ...(await orig<typeof import("@/lib/auth/batchAccess")>()),
  resolveBatchAccess: async () => ({ publicKey: session.publicKey, anonId: null }),
}));

const { PATCH } = await import("./route");
const { POST: checks } = await import("./checks/route");
const { POST: convert } = await import("./convert-failed/route");

const USDC_TESTNET = { code: "USDC", issuer: "GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5" };
const req = (body?: unknown) => new Request("http://test", { method: "POST", body: body === undefined ? undefined : JSON.stringify(body) });
const ctx = (batchId: string) => ({ params: Promise.resolve({ batchId }) });

describe.skipIf(!!process.env.CI)("payment / claimable switch (Testnet)", () => {
  const ids: string[] = [];
  afterAll(() => prisma.batch.deleteMany({ where: { id: { in: ids } } }));

  it("re-checks per type, converts no-trustline rows, and locks once signed", async () => {
    const user = await fundedAccount();
    session.publicKey = user.publicKey();
    const holderless = await fundedAccount(); // exists, no USDC trustline
    const missing = Keypair.random().publicKey(); // does not exist
    const batch = await prisma.batch.create({
      data: {
        network: "TESTNET",
        ownerPublicKey: user.publicKey(),
        sourceAccount: user.publicKey(),
        assetCode: USDC_TESTNET.code,
        assetIssuer: USDC_TESTNET.issuer,
        status: "VALIDATED",
        recipients: {
          create: [holderless.publicKey(), missing].map((destination, i) => ({ rowIndex: i + 1, destination, amount: "5", addressValid: true })),
        },
      },
    });
    ids.push(batch.id);
    const rows = () => prisma.recipient.findMany({ where: { batchId: batch.id }, orderBy: { rowIndex: "asc" } });

    // Payment: neither recipient can receive USDC today.
    expect((await checks(req({}), ctx(batch.id))).status).toBe(200);
    expect((await rows()).map((r) => r.status)).toEqual(["CHECK_FAILED", "CHECK_FAILED"]);

    // Switch to claimable balance: both pass, with notes.
    expect((await PATCH(req({ kind: "CLAIMABLE_BALANCE" }), ctx(batch.id))).status).toBe(200);
    const switched = await prisma.batch.findUniqueOrThrow({ where: { id: batch.id } });
    expect(switched.kind).toBe("CLAIMABLE_BALANCE");
    expect(switched.claimExpiresAt!.getTime()).toBeGreaterThan(Date.now() + 29 * 86_400_000);
    await checks(req({}), ctx(batch.id));
    const cb = await rows();
    expect(cb.map((r) => r.status)).toEqual(["READY", "READY"]);
    expect(cb[0].errorMessage).toMatch(/No trustline yet/);
    expect(cb[1].errorMessage).toMatch(/No account yet/);

    // Back to payment, then move the failed rows into a claimable batch.
    await PATCH(req({ kind: "PAYMENT" }), ctx(batch.id));
    expect((await prisma.batch.findUniqueOrThrow({ where: { id: batch.id } })).claimExpiresAt).toBeNull();
    await checks(req({}), ctx(batch.id));
    const moved = await (await convert(req(), ctx(batch.id))).json();
    expect(moved.moved).toBe(2);
    ids.push(moved.batchId);
    const created = await prisma.batch.findUniqueOrThrow({ where: { id: moved.batchId }, include: { recipients: true } });
    expect(created).toMatchObject({ kind: "CLAIMABLE_BALANCE", assetCode: "USDC", ownerPublicKey: user.publicKey(), sourceAccount: user.publicKey() });
    expect(created.recipients.map((r) => r.destination).sort()).toEqual([holderless.publicKey(), missing].sort());
    expect((await rows()).every((r) => r.errorMessage === "Moved to a claimable balance batch.")).toBe(true);
    expect((await convert(req(), ctx(batch.id))).status).toBe(422); // nothing left to move
  }, 120_000);

  it("cancels an unsigned run on switch and refuses once a run is signed", async () => {
    const user = await fundedAccount();
    session.publicKey = user.publicKey();
    const batch = await prisma.batch.create({
      data: {
        network: "TESTNET",
        ownerPublicKey: user.publicKey(),
        sourceAccount: user.publicKey(),
        status: "READY",
        recipients: { create: [{ rowIndex: 1, destination: Keypair.random().publicKey(), amount: "1", addressValid: true, accountExists: false, status: "READY" }] },
      },
      include: { recipients: true },
    });
    ids.push(batch.id);
    const prepared = await prepareBatchRun({ batch, idempotencyKey: "kind-switch" });
    expect((await PATCH(req({ kind: "CLAIMABLE_BALANCE" }), ctx(batch.id))).status).toBe(200);
    expect(await prisma.distributionRun.findUniqueOrThrow({ where: { id: prepared.runId } })).toMatchObject({ status: "EXPIRED", errorCode: "CANCELLED" });

    await prisma.distributionRun.update({ where: { id: prepared.runId }, data: { signedAt: new Date() } });
    expect((await PATCH(req({ kind: "PAYMENT" }), ctx(batch.id))).status).toBe(409);
  }, 120_000);
});
