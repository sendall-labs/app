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

/**
 * Splits into groups sized for chaining: every group but the last is
 * capped at MAX_OPS_PER_TX - 1 so its transaction has room for one more
 * operation — the SetOptions op that installs the next chunk's hash as a
 * preAuthTx signer. The last group can use the full MAX_OPS_PER_TX since
 * nothing needs to be chained after it.
 */
function chunkForChaining<T>(items: T[]): T[][] {
  const out: T[][] = [];
  let i = 0;
  while (i < items.length) {
    const remaining = items.length - i;
    const size = remaining > MAX_OPS_PER_TX ? MAX_OPS_PER_TX - 1 : remaining;
    out.push(items.slice(i, i + size));
    i += size;
  }
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

/**
 * Builds signable transaction XDRs for a batch of payments, chunked to
 * respect the 100-operation-per-transaction limit. `sourceAccount` must
 * be freshly loaded (e.g. via `rpc.Server#getAccount`) immediately
 * before calling this — each chunk consumes the next sequence number in
 * order, and `sourceAccount` is left incremented by the number of
 * chunks once this returns, so chunks must be submitted in the same
 * order they were built.
 *
 * When there's more than one chunk, only the first needs a wallet
 * signature: every chunk but the last carries an extra SetOptions op
 * that installs the *next* chunk's transaction hash as a preAuthTx
 * signer on the source account. Once a signed chunk lands on-chain,
 * that signer authorizes the next chunk by itself (and the protocol
 * removes it automatically once used) — so the caller only has to
 * prompt the wallet once and can submit the rest unsigned, in order.
 * Built back-to-front since each chunk's SetOptions op needs the hash
 * of the chunk that follows it, which only exists once that later
 * chunk's transaction has been built.
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
  const groups = chunkForChaining(recipients);
  const baseSeq = BigInt(sourceAccount.sequenceNumber());

  let nextChunkHash: Buffer | null = null;
  const chunks: TxChunk[] = [];

  for (let chunkIndex = groups.length - 1; chunkIndex >= 0; chunkIndex--) {
    const group = groups[chunkIndex];
    const isLast = chunkIndex === groups.length - 1;
    // A standalone Account per chunk (seeded at that chunk's own prior
    // sequence number) instead of the shared, mutating sourceAccount —
    // building back-to-front means chunks aren't built in sequence order.
    const chunkAccount = new Account(sourceAccount.accountId(), (baseSeq + BigInt(chunkIndex)).toString());
    const builder = new TransactionBuilder(chunkAccount, {
      fee: baseFeeStroops ?? BASE_FEE,
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

    if (!isLast && nextChunkHash) {
      builder.addOperation(Operation.setOptions({ signer: { preAuthTx: nextChunkHash, weight: 1 } }));
    }

    const tx = builder.build();
    nextChunkHash = tx.hash();

    chunks[chunkIndex] = {
      chunkIndex,
      xdr: tx.toXDR(),
      operationCount: group.length,
      items,
      requiresSignature: chunkIndex === 0,
    };
  }

  for (let i = 0; i < groups.length; i++) sourceAccount.incrementSequenceNumber();

  return chunks;
}
