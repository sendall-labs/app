import { Keypair, Operation, TransactionBuilder } from "@stellar/stellar-sdk";
import type { Network } from "@/generated/prisma/enums";
import type { ChannelAccount } from "@/generated/prisma/client";
import { prisma } from "@/lib/db/prisma";
import { decryptSecret, encryptSecret } from "@/lib/crypto/serviceKeys";
import { getNetworkPassphrase, getRpcServer } from "@/lib/stellar/client";
import { getSponsorKeypair } from "@/lib/stellar/serviceAccounts";
import { submitAndPoll } from "@/lib/stellar/submit";
import { DistributionError } from "./errors";

// Channel accounts never pay fees (every transaction they source is
// fee-bumped by the sponsor), so they only need the minimum balance of
// two base reserves plus headroom in case the base reserve rises.
export const CHANNEL_STARTING_BALANCE = "2";
export const DEFAULT_POOL_SIZE = Number(process.env.CHANNEL_POOL_SIZE ?? 20);
const MAX_OPS_PER_TX = 100;

export type ReservedChannel = Pick<ChannelAccount, "id" | "publicKey"> & {
  // The account's current on-chain sequence. The transaction built on
  // this channel must use currentSequence + 1.
  currentSequence: string;
};

export function channelKeypair(channel: Pick<ChannelAccount, "encryptedSecret">): Keypair {
  return Keypair.fromSecret(decryptSecret(channel.encryptedSecret));
}

/**
 * Creates `count` new channel accounts funded by the sponsor. Rows are
 * written (quarantined) before anything touches the network, so an
 * interrupted run never leaves a funded account whose key was lost.
 */
export async function provisionChannels(network: Network, count: number): Promise<string[]> {
  if (count <= 0) return [];
  const sponsor = getSponsorKeypair(network);
  const server = getRpcServer(network);
  const created: string[] = [];

  for (let offset = 0; offset < count; offset += MAX_OPS_PER_TX) {
    const keys = Array.from({ length: Math.min(MAX_OPS_PER_TX, count - offset) }, () => Keypair.random());
    await prisma.channelAccount.createMany({
      data: keys.map((kp) => ({
        network,
        publicKey: kp.publicKey(),
        encryptedSecret: encryptSecret(kp.secret()),
        status: "QUARANTINED",
        lastError: "provisioning",
      })),
    });

    const builder = new TransactionBuilder(await server.getAccount(sponsor.publicKey()), {
      fee: "1000",
      networkPassphrase: getNetworkPassphrase(network),
    }).setTimeout(120);
    for (const kp of keys) {
      builder.addOperation(Operation.createAccount({ destination: kp.publicKey(), startingBalance: CHANNEL_STARTING_BALANCE }));
    }
    const tx = builder.build();
    tx.sign(sponsor);
    const result = await submitAndPoll(network, tx.toXDR());
    const publicKeys = keys.map((kp) => kp.publicKey());

    if (result.status !== "SUCCESS") {
      // Nothing was created on-chain, so the keys are worthless.
      await prisma.channelAccount.deleteMany({ where: { publicKey: { in: publicKeys } } });
      throw new Error(`Channel provisioning failed (${result.status}, tx ${result.hash}).`);
    }
    await prisma.channelAccount.updateMany({
      where: { publicKey: { in: publicKeys } },
      data: { status: "AVAILABLE", lastError: null },
    });
    created.push(...publicKeys);
  }
  return created;
}

/** Tops the pool up to `size` channels for this network. */
export async function ensurePool(network: Network, size = DEFAULT_POOL_SIZE): Promise<number> {
  // Rows stuck mid-provisioning (lastError "provisioning") do not count.
  // `not` alone would also drop NULL rows in SQL, hence the OR.
  const existing = await prisma.channelAccount.count({
    where: { network, OR: [{ lastError: null }, { lastError: { not: "provisioning" } }] },
  });
  const missing = Math.max(0, size - existing);
  if (missing > 0) await provisionChannels(network, missing);
  return missing;
}

/**
 * Locks `count` available channels for one run. Rows are claimed with
 * FOR UPDATE SKIP LOCKED inside one transaction, so two runs preparing
 * at the same moment can never receive the same channel, and a channel
 * whose next sequence is promised to an authorized transaction is never
 * handed out again until it is released.
 */
export async function reserveChannels(params: {
  network: Network;
  count: number;
  runId: string;
  expiresAt: Date;
}): Promise<ReservedChannel[]> {
  const { network, count, runId, expiresAt } = params;
  const locked = await prisma.$transaction(async (tx) => {
    const rows = await tx.$queryRaw<{ id: string; publicKey: string }[]>`
      SELECT "id", "publicKey" FROM "ChannelAccount"
      WHERE "network" = ${network}::"Network" AND "status" = 'AVAILABLE'
      ORDER BY "updatedAt" ASC
      LIMIT ${count}
      FOR UPDATE SKIP LOCKED`;
    if (rows.length < count) {
      throw new DistributionError(
        "INSUFFICIENT_CHANNELS",
        `Sendall is busy right now (${rows.length} of ${count} channels free). Try again in a minute.`,
        { available: rows.length, required: count }
      );
    }
    await tx.channelAccount.updateMany({
      where: { id: { in: rows.map((r) => r.id) } },
      data: { status: "RESERVED", runId, lockedAt: new Date(), expiresAt, expectedSequence: null, transactionId: null },
    });
    return rows;
  });

  const server = getRpcServer(network);
  try {
    return await Promise.all(
      locked.map(async (row) => {
        const account = await server.getAccount(row.publicKey);
        return { ...row, currentSequence: account.sequenceNumber() };
      })
    );
  } catch (err) {
    await releaseChannels(locked.map((r) => r.id));
    throw err;
  }
}

/** Records which transaction (and therefore which sequence) a reserved channel is promised to. */
export async function assignChannel(channelId: string, transactionId: string, expectedSequence: string) {
  await prisma.channelAccount.update({
    where: { id: channelId },
    data: { transactionId, expectedSequence },
  });
}

export async function setChannelStatus(channelId: string, status: "SUBMITTED" | "AWAITING_CONFIRMATION") {
  await prisma.channelAccount.update({ where: { id: channelId }, data: { status } });
}

export async function quarantineChannel(channelId: string, reason: string) {
  await prisma.channelAccount.update({ where: { id: channelId }, data: { status: "QUARANTINED", lastError: reason } });
}

export async function releaseChannels(channelIds: string[]) {
  if (channelIds.length === 0) return;
  await prisma.channelAccount.updateMany({
    where: { id: { in: channelIds } },
    data: {
      status: "AVAILABLE",
      runId: null,
      transactionId: null,
      expectedSequence: null,
      lockedAt: null,
      expiresAt: null,
      lastError: null,
    },
  });
}

/**
 * Returns channels whose reservation has outlived its transaction's time
 * bounds. Past that point the pre-authorized transaction can never be
 * applied, so whatever happened to the channel's sequence, nothing still
 * depends on it and it is safe to hand out again. Channels that are
 * mid-provisioning have no expiresAt, so they never match.
 */
export async function sweepExpiredReservations(now = new Date()): Promise<number> {
  const result = await prisma.channelAccount.updateMany({
    where: {
      status: { in: ["RESERVED", "SUBMITTED", "AWAITING_CONFIRMATION", "QUARANTINED"] },
      expiresAt: { lt: now },
    },
    data: {
      status: "AVAILABLE",
      runId: null,
      transactionId: null,
      expectedSequence: null,
      lockedAt: null,
      expiresAt: null,
      lastError: null,
    },
  });
  return result.count;
}
