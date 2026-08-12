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
