import { afterAll, describe, expect, it, vi } from "vitest";
import { Keypair } from "@stellar/stellar-sdk";
import { prisma } from "@/lib/db/prisma";

const owner = Keypair.random().publicKey();
vi.mock("@/lib/auth/batchAccess", async (orig) => ({
  ...(await orig<typeof import("@/lib/auth/batchAccess")>()),
  resolveBatchAccess: async () => ({ publicKey: owner, anonId: null }),
}));
const { POST } = await import("./authorize/route");

describe("Mainnet authorization gate", () => {
  let batchId = "";
  afterAll(() => prisma.batch.deleteMany({ where: { id: batchId } }));

  it("refuses to authorize a Mainnet run without the explicit confirmation", async () => {
    const batch = await prisma.batch.create({ data: { network: "PUBLIC", ownerPublicKey: owner, sourceAccount: owner } });
    batchId = batch.id;
    const run = await prisma.distributionRun.create({
      data: {
        batchId: batch.id,
        idempotencyKey: `mainnet-gate-${batch.id}`,
        network: "PUBLIC",
        sourceAccount: owner,
        sponsorAccount: Keypair.random().publicKey(),
        status: "AWAITING_USER_SIGNATURE",
      },
    });
    const call = (body: unknown) =>
      POST(new Request("http://test", { method: "POST", body: JSON.stringify(body) }), { params: Promise.resolve({ runId: run.id }) });

    const refused = await call({ signedXdr: "AAAA" });
    expect(refused.status).toBe(428);
    expect((await refused.json()).code).toBe("MAINNET_CONFIRMATION_REQUIRED");
    expect((await call({ signedXdr: "AAAA", confirmMainnet: false })).status).toBe(428);
    // With the confirmation it gets past the gate (and fails later on the bogus XDR, never reaching the network).
    expect((await call({ signedXdr: "AAAA", confirmMainnet: true })).status).not.toBe(428);
    expect((await prisma.distributionRun.findUniqueOrThrow({ where: { id: run.id } })).status).toBe("AWAITING_USER_SIGNATURE");
  });
});
