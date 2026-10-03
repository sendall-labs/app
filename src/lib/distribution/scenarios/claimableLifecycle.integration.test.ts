import { afterAll, describe, expect, it } from "vitest";
import { prisma } from "@/lib/db/prisma";
import { getHorizonServer } from "@/lib/stellar/client";
import { runClaimableLifecycle } from "./claimableLifecycle";

describe.skipIf(!!process.env.CI)("claimable balance lifecycle (Testnet)", () => {
  let batchId = "";
  afterAll(() => (batchId ? prisma.batch.delete({ where: { id: batchId } }) : undefined));

  it("create to recipients without a trustline, claim, then reclaim the rest", async () => {
    const result = await runClaimableLifecycle(50);
    batchId = result.batchId;
    expect(result.recipients.map((r) => r.outcome)).toEqual(["CLAIMED", "RECLAIMED", "RECLAIMED"]);
    expect(result.recipients[0].claimTx).toBe(result.claimTx);
    expect(result.send.chunkTxs).toHaveLength(1);
    expect(result.reclaim.chunkTxs).toHaveLength(1);
    const horizon = getHorizonServer("TESTNET");
    const a = await horizon.loadAccount(result.recipients[0].address);
    expect(a.balances.find((b) => "asset_code" in b && b.asset_code === "SNDL")?.balance).toBe("50.0000000");
    const sender = await horizon.loadAccount(result.sender);
    expect(sender.balances.find((b) => "asset_code" in b && b.asset_code === "SNDL")?.balance).toBe("950.0000000");
    expect(sender.num_sponsoring).toBe(0); // every claimant reserve released
  }, 300_000);
});
