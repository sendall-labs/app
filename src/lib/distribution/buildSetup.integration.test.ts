import { afterAll, describe, expect, it } from "vitest";
import { Keypair, TransactionBuilder, type Transaction } from "@stellar/stellar-sdk";
import { prisma } from "@/lib/db/prisma";
import { getHorizonServer, getNetworkPassphrase, getRpcServer, NETWORK_CONFIG } from "@/lib/stellar/client";
import { getSponsorKeypair } from "@/lib/stellar/serviceAccounts";
import { submitAndPoll } from "@/lib/stellar/submit";
import { buildChunks } from "./buildChunks";
import { buildSetup } from "./buildSetup";
import { channelKeypair, releaseChannels, reserveChannels } from "./channelPool";

// End-to-end proof of the core mechanism, before fee bumps and the engine
// exist: a sponsored preAuthTx signer lets a channel-sourced transaction
// move the sender's funds, and disappears (with its sponsorship) once used.
describe.skipIf(!!process.env.CI)("setup + chunk on Testnet", () => {
  const held: string[] = [];
  afterAll(() => releaseChannels(held));

  it("installs a sponsored signer that one channel tx consumes", async () => {
    const network = "TESTNET" as const;
    const passphrase = getNetworkPassphrase(network);
    const horizon = getHorizonServer(network);
    const sponsor = getSponsorKeypair(network);
    const user = Keypair.random();
    expect((await fetch(`${NETWORK_CONFIG.TESTNET.friendbot}?addr=${user.publicKey()}`)).ok).toBe(true);

    const [channel] = await reserveChannels({ network, count: 1, runId: "it-setup", expiresAt: new Date(Date.now() + 600_000) });
    held.push(channel.id);
    const maxTime = new Date(Date.now() + 10 * 60_000);
    const [chunk] = buildChunks({
      network,
      sourceAccount: user.publicKey(),
      asset: null,
      ops: [{ kind: "payment", recipientId: "r0", destination: sponsor.publicKey(), amount: "1" }],
      channels: [channel],
      maxTime,
    });

    const userAccount = await getRpcServer(network).getAccount(user.publicKey());
    const setup = buildSetup({
      network,
      sourceAccount: user.publicKey(),
      sourceSequence: userAccount.sequenceNumber(),
      sponsor,
      chunkHashes: [chunk.hash],
      preAuthWeight: 1,
      maxTime: new Date(Date.now() + 5 * 60_000),
    });
    const setupTx = TransactionBuilder.fromXDR(setup.xdr, passphrase) as Transaction;
    setupTx.sign(user); // what the wallet does
    const setupResult = await submitAndPoll(network, setupTx.toXDR());
    expect(setupResult.status).toBe("SUCCESS");

    const afterSetup = await horizon.loadAccount(user.publicKey());
    expect(afterSetup.signers.some((s) => s.type === "preauth_tx")).toBe(true);
    expect(afterSetup.num_sponsored).toBe(1);

    const row = await prisma.channelAccount.findUniqueOrThrow({ where: { id: channel.id } });
    const chunkTx = TransactionBuilder.fromXDR(chunk.xdr, passphrase) as Transaction;
    chunkTx.sign(channelKeypair(row)); // no user signature
    const chunkResult = await submitAndPoll(network, chunkTx.toXDR());
    expect(chunkResult.status).toBe("SUCCESS");
    expect(chunkResult.hash).toBe(chunk.hash);

    const afterChunk = await horizon.loadAccount(user.publicKey());
    expect(afterChunk.signers.some((s) => s.type === "preauth_tx")).toBe(false);
    expect(afterChunk.num_sponsored).toBe(0);
  }, 120_000);
});
