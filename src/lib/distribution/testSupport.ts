// Shared helpers for the Testnet integration tests in this folder.
import { Keypair, TransactionBuilder, type Transaction } from "@stellar/stellar-sdk";
import type { BatchKind } from "@/generated/prisma/enums";
import { prisma } from "@/lib/db/prisma";
import { getNetworkPassphrase, NETWORK_CONFIG } from "@/lib/stellar/client";
import { advanceRun } from "./engine";

export const TESTNET = "TESTNET" as const;

export async function fundedAccount(): Promise<Keypair> {
  const kp = Keypair.random();
  const res = await fetch(`${NETWORK_CONFIG.TESTNET.friendbot}?addr=${kp.publicKey()}`);
  if (!res.ok) throw new Error(`friendbot failed: ${res.status}`);
  return kp;
}

export async function seedBatch(
  owner: string,
  destinations: string[],
  kind: BatchKind = "PAYMENT",
  amount = "1",
  extra: { accountExists?: boolean; assetCode?: string; assetIssuer?: string; claimExpiresAt?: Date } = {}
) {
  return prisma.batch.create({
    data: {
      network: TESTNET,
      ownerPublicKey: owner,
      sourceAccount: owner,
      status: "READY",
      kind,
      assetCode: extra.assetCode,
      assetIssuer: extra.assetIssuer,
      claimExpiresAt: extra.claimExpiresAt,
      recipients: {
        create: destinations.map((destination, i) => ({
          rowIndex: i,
          destination,
          amount,
          addressValid: true,
          accountExists: extra.accountExists,
          status: "READY" as const,
        })),
      },
    },
    include: { recipients: { orderBy: { rowIndex: "asc" } } },
  });
}

export function signLikeWallet(setupXdr: string, signer: Keypair): string {
  const tx = TransactionBuilder.fromXDR(setupXdr, getNetworkPassphrase(TESTNET)) as Transaction;
  tx.sign(signer);
  return tx.toXDR();
}

export async function driveToEnd(runId: string, maxSteps = 8) {
  let run = await advanceRun(runId);
  for (let i = 0; i < maxSteps && !["COMPLETED", "PARTIALLY_FAILED", "FAILED", "EXPIRED"].includes(run.status); i++) {
    await new Promise((r) => setTimeout(r, 1000));
    run = await advanceRun(runId);
  }
  return run;
}

/** Submits a classic transaction signed by `signer` (test setup only). */
export async function submitAs(signer: Keypair, build: (b: import("@stellar/stellar-sdk").TransactionBuilder) => void) {
  const { getRpcServer } = await import("@/lib/stellar/client");
  const { submitAndPoll } = await import("@/lib/stellar/submit");
  const account = await getRpcServer(TESTNET).getAccount(signer.publicKey());
  const builder = new TransactionBuilder(account, { fee: "1000", networkPassphrase: getNetworkPassphrase(TESTNET) }).setTimeout(120);
  build(builder);
  const tx = builder.build();
  tx.sign(signer);
  const res = await submitAndPoll(TESTNET, tx.toXDR());
  if (res.status !== "SUCCESS") throw new Error(`test setup tx failed: ${JSON.stringify(res.perOperation)}`);
  return res;
}

export const randomKeys = (n: number) => Array.from({ length: n }, () => Keypair.random().publicKey());
