import {
  Account,
  Asset,
  BASE_FEE,
  MuxedAccount,
  Operation,
  StrKey,
  TransactionBuilder,
} from "@stellar/stellar-sdk";
import type { Network } from "@/generated/prisma/enums";
import { getNetworkPassphrase } from "./client";

// Protocol-enforced max operations per transaction.
export const MAX_OPS_PER_TX = 100;
const TX_TIMEOUT_SECONDS = 300;

export type ChunkRecipient = {
  recipientId: string;
  destination: string;
  amount: string;
  needsCreateAccount: boolean;
};

export type TxChunk = {
  chunkIndex: number;
  xdr: string;
  operationCount: number;
  items: { recipientId: string; operationIndex: number }[];
  // false when this chunk is authorized by a preAuthTx signer the
  // previous chunk installed on the source account (its hash was baked
  // into that chunk's SetOptions op) — submit it exactly as built, with
  // no wallet signature. true means it still needs a real signature.
  requiresSignature: boolean;
};

function chunkArray<T>(items: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

/**
 * A `createAccount` operation can only target the underlying Ed25519
 * (G...) account — muxed (M...) ids are a client-side routing concept
 * layered on an account that must already exist, so this only matters
 * as a defensive fallback.
 */
function createAccountDestination(destination: string): string {
  if (!StrKey.isValidMed25519PublicKey(destination)) return destination;
  return MuxedAccount.fromAddress(destination, "0").baseAccount().accountId();
}

function buildPaymentTx(params: {
  passphrase: string;
  sourcePublicKey: string;
  seedSequence: string;
  fee: string;
  asset: Asset | null;
  group: ChunkRecipient[];
}) {
  const { passphrase, sourcePublicKey, seedSequence, fee, asset, group } = params;
  const chunkAccount = new Account(sourcePublicKey, seedSequence);
  const builder = new TransactionBuilder(chunkAccount, {
    fee,
    networkPassphrase: passphrase,
  }).setTimeout(TX_TIMEOUT_SECONDS);

  const items: { recipientId: string; operationIndex: number }[] = [];

  group.forEach((r, operationIndex) => {
    if (!asset && r.needsCreateAccount) {
      builder.addOperation(
        Operation.createAccount({
          destination: createAccountDestination(r.destination),
          startingBalance: r.amount,
        })
      );
    } else {
      builder.addOperation(
        Operation.payment({
          destination: r.destination,
          asset: asset ?? Asset.native(),
          amount: r.amount,
        })
      );
    }
    items.push({ recipientId: r.recipientId, operationIndex });
  });

  return { tx: builder.build(), items };
}

/**
 * Builds signable transaction XDRs for a batch of payments, chunked to
 * respect the 100-operation-per-transaction limit. `sourceAccount` must
 * be freshly loaded (e.g. via `rpc.Server#getAccount`) immediately
 * before calling this — each chunk consumes the next sequence number in
 * order, and `sourceAccount` is left incremented by the number of
 * chunks once this returns, so chunks must be submitted in the same
 * order they were built.
 *
 * A single chunk (<= 100 recipients) is just a normal signed payment
 * tx. Beyond that, only one signature is ever requested: instead of
 * each payment chunk asking the wallet to review 100 real payments
 * (slow — wallets run destination/malicious-transaction checks on
 * every operation), a small "master" tx is built first containing
 * *only* SetOptions ops — one per payment chunk, each installing that
 * chunk's transaction hash as a preAuthTx signer. The master tx is the
 * one thing the wallet ever signs; every payment chunk is authorized
 * directly by it (not by the chunk before it) and submitted unsigned,
 * in sequence order. The protocol removes each preAuthTx signer once
 * its matching chunk lands, so there's no cleanup.
 */
export function buildPaymentChunks(params: {
  network: Network;
  sourceAccount: Account;
  asset: Asset | null; // null = native XLM
  recipients: ChunkRecipient[];
  baseFeeStroops?: string;
}): TxChunk[] {
  const { network, sourceAccount, asset, recipients, baseFeeStroops } = params;
  const passphrase = getNetworkPassphrase(network);
  const fee = baseFeeStroops ?? BASE_FEE;
  const groups = chunkArray(recipients, MAX_OPS_PER_TX);
  const baseSeq = BigInt(sourceAccount.sequenceNumber());
  const sourcePublicKey = sourceAccount.accountId();

  if (groups.length <= 1) {
    const { tx, items } = buildPaymentTx({
      passphrase,
      sourcePublicKey,
      seedSequence: baseSeq.toString(),
      fee,
      asset,
      group: groups[0] ?? [],
    });
    sourceAccount.incrementSequenceNumber();
    return [
      {
        chunkIndex: 0,
        xdr: tx.toXDR(),
        operationCount: groups[0]?.length ?? 0,
        items,
        requiresSignature: true,
      },
    ];
  }

  // Payment chunks don't depend on each other, so build order doesn't
  // matter — each just needs its own sequence number, offset by one to
  // leave room for the master tx at baseSeq + 1.
  const paymentChunks = groups.map((group, i) =>
    buildPaymentTx({
      passphrase,
      sourcePublicKey,
      seedSequence: (baseSeq + BigInt(i + 1)).toString(),
      fee,
      asset,
      group,
    })
  );

  const masterAccount = new Account(sourcePublicKey, baseSeq.toString());
  const masterBuilder = new TransactionBuilder(masterAccount, {
    fee,
    networkPassphrase: passphrase,
  }).setTimeout(TX_TIMEOUT_SECONDS);
  for (const { tx } of paymentChunks) {
    masterBuilder.addOperation(Operation.setOptions({ signer: { preAuthTx: tx.hash(), weight: 1 } }));
  }
  const masterTx = masterBuilder.build();

  const chunks: TxChunk[] = [
    {
      chunkIndex: 0,
      xdr: masterTx.toXDR(),
      operationCount: paymentChunks.length,
      items: [],
      requiresSignature: true,
    },
    ...paymentChunks.map(({ tx, items }, i) => ({
      chunkIndex: i + 1,
      xdr: tx.toXDR(),
      operationCount: groups[i].length,
      items,
      requiresSignature: false,
    })),
  ];

  for (let i = 0; i < chunks.length; i++) sourceAccount.incrementSequenceNumber();

  return chunks;
}
