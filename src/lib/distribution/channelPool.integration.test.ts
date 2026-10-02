import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "@/lib/db/prisma";
import { getRpcServer } from "@/lib/stellar/client";
import {
  channelKeypair,
  ensurePool,
  quarantineChannel,
  releaseChannels,
  reserveChannels,
  sweepExpiredReservations,
} from "./channelPool";
import { DistributionError } from "./errors";

const soon = () => new Date(Date.now() + 60_000);

describe.skipIf(!!process.env.CI)("channel pool (Testnet + local DB)", () => {
  const held: string[] = [];

  beforeAll(async () => {
    await ensurePool("TESTNET", 6);
  }, 120_000);

  afterAll(async () => {
    await releaseChannels(held);
  });

  it("provisions funded channels whose keys decrypt", async () => {
    const channel = await prisma.channelAccount.findFirstOrThrow({ where: { network: "TESTNET", status: "AVAILABLE" } });
    expect(channelKeypair(channel).publicKey()).toBe(channel.publicKey);
    const account = await getRpcServer("TESTNET").getAccount(channel.publicKey);
    expect(BigInt(account.sequenceNumber())).toBeGreaterThan(BigInt(0));
  }, 30_000);

  it("never hands the same channel to two concurrent runs", async () => {
    const [a, b] = await Promise.all([
      reserveChannels({ network: "TESTNET", count: 2, runId: "test-run-a", expiresAt: soon() }),
      reserveChannels({ network: "TESTNET", count: 2, runId: "test-run-b", expiresAt: soon() }),
    ]);
    held.push(...a.map((c) => c.id), ...b.map((c) => c.id));
    const ids = new Set([...a, ...b].map((c) => c.id));
    expect(ids.size).toBe(4);
    for (const c of [...a, ...b]) expect(c.currentSequence).toMatch(/^\d+$/);
    const rows = await prisma.channelAccount.findMany({ where: { id: { in: [...ids] } } });
    expect(rows.every((r) => r.status === "RESERVED")).toBe(true);
  }, 30_000);

  it("refuses when the pool cannot cover the run and locks nothing", async () => {
    const before = await prisma.channelAccount.count({ where: { network: "TESTNET", status: "AVAILABLE" } });
    await expect(
      reserveChannels({ network: "TESTNET", count: before + 1, runId: "test-run-c", expiresAt: soon() })
    ).rejects.toBeInstanceOf(DistributionError);
    expect(await prisma.channelAccount.count({ where: { network: "TESTNET", status: "AVAILABLE" } })).toBe(before);
  });

  it("releases expired reservations, including quarantined ones", async () => {
    const [c] = await reserveChannels({ network: "TESTNET", count: 1, runId: "test-run-d", expiresAt: new Date(Date.now() - 1000) });
    await quarantineChannel(c.id, "test drift");
    expect(await sweepExpiredReservations()).toBeGreaterThanOrEqual(1);
    const row = await prisma.channelAccount.findUniqueOrThrow({ where: { id: c.id } });
    expect(row).toMatchObject({ status: "AVAILABLE", runId: null, lastError: null });
  }, 30_000);
});
