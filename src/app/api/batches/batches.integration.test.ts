import { afterAll, describe, expect, it, vi } from "vitest";
import { Keypair } from "@stellar/stellar-sdk";
import { prisma } from "@/lib/db/prisma";

const owner = Keypair.random().publicKey();
vi.mock("@/lib/auth/requireSession", () => ({ getSessionPublicKey: async () => owner }));
vi.mock("@/lib/auth/batchAccess", async (orig) => ({
  ...(await orig<typeof import("@/lib/auth/batchAccess")>()),
  resolveBatchAccess: async () => ({ publicKey: owner, anonId: null }),
}));

const { GET, POST } = await import("./route");

const post = (body: unknown) => POST(new Request("http://test", { method: "POST", body: JSON.stringify(body) }));

describe("batches API: distribution type", () => {
  afterAll(() => prisma.batch.deleteMany({ where: { ownerPublicKey: owner } }));

  it("creates payment batches by default and claimable ones with a 30-day window", async () => {
    const payment = (await (await post({ csvText: "destination,amount,memo\n", network: "TESTNET" })).json()).batch;
    expect(payment.kind).toBe("PAYMENT");
    expect(payment.claimExpiresAt).toBeNull();

    const before = Date.now();
    const claimable = (await (await post({ csvText: "destination,amount,memo\n", network: "TESTNET", kind: "CLAIMABLE_BALANCE" })).json()).batch;
    expect(claimable.kind).toBe("CLAIMABLE_BALANCE");
    const days = (new Date(claimable.claimExpiresAt).getTime() - before) / 86_400_000;
    expect(days).toBeGreaterThan(29.9);
    expect(days).toBeLessThan(30.1);

    expect((await post({ csvText: "x", network: "TESTNET", kind: "OTHER" })).status).toBe(400);
  });

  it("lists claim progress for claimable batches only", async () => {
    const batch = await prisma.batch.create({
      data: {
        network: "TESTNET",
        ownerPublicKey: owner,
        kind: "CLAIMABLE_BALANCE",
        recipients: {
          create: [
            { rowIndex: 1, destination: Keypair.random().publicKey(), amount: "1", claimStatus: "CLAIMED" },
            { rowIndex: 2, destination: Keypair.random().publicKey(), amount: "1", claimStatus: "UNCLAIMED" },
            { rowIndex: 3, destination: Keypair.random().publicKey(), amount: "1", claimStatus: "RECLAIMED" },
            { rowIndex: 4, destination: Keypair.random().publicKey(), amount: "1" },
          ],
        },
      },
    });
    const { batches } = await (await GET()).json();
    const listed = batches.find((b: { id: string }) => b.id === batch.id);
    expect(listed.claims).toEqual({ created: 3, claimed: 1, reclaimed: 1 });
    expect(batches.filter((b: { kind: string }) => b.kind === "PAYMENT").every((b: { claims: unknown }) => b.claims === null)).toBe(true);
  });
});
