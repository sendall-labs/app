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

/**
 * Builds signable transaction XDRs for a batch of payments, chunked to
 * respect the 100-operation-per-transaction limit. `sourceAccount` must
 * be freshly loaded (e.g. via `rpc.Server#getAccount`) immediately
 * before calling this — each built chunk consumes the next sequence
 * number in order via the SDK's `TransactionBuilder`, which mutates
 * `sourceAccount` in place, so chunks must be submitted in the same
 * order they were built.
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
  const groups = chunkArray(recipients, MAX_OPS_PER_TX);

  return groups.map((group, chunkIndex) => {
    const builder = new TransactionBuilder(sourceAccount, {
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

    const tx = builder.build();

    return {
      chunkIndex,
      xdr: tx.toXDR(),
      operationCount: group.length,
      items,
    };
  });
}
