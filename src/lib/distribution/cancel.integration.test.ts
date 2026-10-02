import { afterAll, describe, expect, it } from "vitest";
import { prisma } from "@/lib/db/prisma";
import { prepareBatchRun } from "./batchRuns";
import { authorizeRun, cancelRun } from "./engine";
import { fundedAccount, randomKeys, seedBatch, signLikeWallet } from "./testSupport";

describe.skipIf(!!process.env.CI)("cancel at review (Testnet)", () => {
  const batchIds: string[] = [];
  afterAll(() => prisma.batch.deleteMany({ where: { id: { in: batchIds } } }));

  it("frees channels and rows, and the batch can be prepared again", async () => {
    const user = await fundedAccount();
    const seeded = await seedBatch(user.publicKey(), randomKeys(3), "PAYMENT", "1", { accountExists: false });
    batchIds.push(seeded.id);
    const load = () => prisma.batch.findUniqueOrThrow({ where: { id: seeded.id }, include: { recipients: true } });

    const first = await prepareBatchRun({ batch: await load(), idempotencyKey: "cancel-1" });
    const [chunk] = await prisma.channelTransaction.findMany({ where: { runId: first.runId } });
    const cancelled = await cancelRun(first.runId);
    expect(cancelled).toMatchObject({ status: "EXPIRED", errorCode: "CANCELLED" });
    expect((await cancelRun(first.runId)).status).toBe("EXPIRED"); // idempotent
    expect((await prisma.channelAccount.findUniqueOrThrow({ where: { publicKey: chunk.channelPublicKey } })).status).toBe("AVAILABLE");
    const batch = await load();
    expect(batch.status).toBe("READY");
    expect(batch.recipients.every((r) => r.status === "READY")).toBe(true);

    // A cancelled setup can no longer be authorized.
    await expect(authorizeRun(first.runId, signLikeWallet(first.setupXdr, user))).rejects.toMatchObject({ code: "INVALID_STATE" });

    const second = await prepareBatchRun({ batch: await load(), idempotencyKey: "cancel-2" });
    expect(second.runId).not.toBe(first.runId);
    await cancelRun(second.runId);
  }, 120_000);
});
