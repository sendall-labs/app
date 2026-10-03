import { BASE_FEE, FeeBumpTransaction, Keypair, rpc, TransactionBuilder, xdr, type Transaction } from "@stellar/stellar-sdk";
import type { Network } from "@/generated/prisma/enums";
import { getNetworkPassphrase, getRpcServer } from "@/lib/stellar/client";
import { decodePerOperationResults } from "@/lib/stellar/submit";

// Highest per-operation fee the sponsor will bid, in stroops. Keeps a
// surge from draining the sponsor; the run waits rather than overpays.
// FEE_CAP_STROOPS_PER_OP_<NETWORK> overrides the shared default per network.
export function feeCapPerOp(network: Network): bigint {
  // Blank values (as in .env.example) count as unset, never as a 0 cap.
  const pick = (v: string | undefined) => (v && v.trim() ? v.trim() : undefined);
  return BigInt(pick(process.env[`FEE_CAP_STROOPS_PER_OP_${network}`]) ?? pick(process.env.FEE_CAP_STROOPS_PER_OP) ?? 10_000);
}

const POLL_INTERVAL_MS = 1_000;
const POLL_TIMEOUT_MS = 45_000;
const TRY_AGAIN_ATTEMPTS = 5;

export type OpResult = { operationIndex: number; success: boolean; code: string };

// SUCCESS / FAILED: the transaction reached the ledger. A failed one has
// still consumed its sequence number and its preAuthTx signer.
// REJECTED: refused before reaching the ledger (bad sequence, fee too
// low, too late...). Nothing was consumed.
// TIMEOUT: outcome unknown; look the hash up again before doing anything.
export type SubmitOutcome = {
  status: "SUCCESS" | "FAILED" | "REJECTED" | "TIMEOUT";
  hash: string;
  txCode?: string;
  resultXdr?: string;
  ledger?: number;
  perOperation: OpResult[];
};

/**
 * Per-operation bid. A distribution fills ledgers, so bidding the median
 * loses to surge pricing: chunks bid twice the recent p99 (at least ten
 * times the base fee) and double on each retry after a fee rejection,
 * never above the cap. Unused bid is not charged: the network charges
 * the ledger's effective rate, not the bid.
 */
export async function feeRatePerOp(network: Network, attempt = 0): Promise<string> {
  const floor = BigInt(BASE_FEE) * BigInt(10);
  let rate = floor;
  try {
    const stats = await getRpcServer(network).getFeeStats();
    const p99 = BigInt(stats.inclusionFee.p99) * BigInt(2);
    if (p99 > rate) rate = p99;
  } catch {
    // keep the floor
  }
  rate = rate * BigInt(2) ** BigInt(Math.min(attempt, 10));
  const cap = feeCapPerOp(network);
  return (rate > cap ? cap : rate).toString();
}

/** Wraps a fully signed inner transaction so the sponsor pays its fee. */
export function buildFeeBump(params: { network: Network; sponsor: Keypair; innerXdr: string; feePerOp: string }) {
  const passphrase = getNetworkPassphrase(params.network);
  const inner = TransactionBuilder.fromXDR(params.innerXdr, passphrase);
  if (inner instanceof FeeBumpTransaction) throw new Error("Inner transaction is already a fee bump.");
  const bump = TransactionBuilder.buildFeeBumpTransaction(params.sponsor, params.feePerOp, inner as Transaction, passphrase);
  bump.sign(params.sponsor);
  return { xdr: bump.toXDR(), hash: bump.hash().toString("hex"), innerHash: (inner as Transaction).hash().toString("hex") };
}

// A fee bump's result wraps the inner transaction's result. The inner
// result exposes the same result().results() shape the op decoder reads.
function unwrap(result: xdr.TransactionResult): { txCode: string; inner: xdr.TransactionResult } {
  const kind = result.result().switch().name;
  if (kind === "txFeeBumpInnerSuccess" || kind === "txFeeBumpInnerFailed") {
    const innerResult = result.result().innerResultPair().result();
    return { txCode: innerResult.result().switch().name, inner: innerResult as unknown as xdr.TransactionResult };
  }
  return { txCode: kind, inner: result };
}

/** Raw per-operation results of a (possibly fee-bumped) transaction. */
export function operationResults(resultXdr: string): xdr.OperationResult[] {
  const { inner } = unwrap(xdr.TransactionResult.fromXDR(resultXdr, "base64"));
  try {
    return inner.result().results() ?? [];
  } catch {
    return [];
  }
}

export function describeResult(result: xdr.TransactionResult): { txCode: string; perOperation: OpResult[] } {
  const { txCode, inner } = unwrap(result);
  let perOperation: OpResult[] = [];
  try {
    perOperation = decodePerOperationResults(inner);
  } catch {
    // tx-level failures (txBAD_AUTH, txTOO_LATE...) carry no op results.
  }
  return { txCode, perOperation };
}

/** Looks a hash up on the network. null = not known (yet). */
export async function lookupTransaction(network: Network, hash: string): Promise<SubmitOutcome | null> {
  const res = await getRpcServer(network).getTransaction(hash);
  if (res.status === rpc.Api.GetTransactionStatus.NOT_FOUND) return null;
  const { txCode, perOperation } = res.resultXdr ? describeResult(res.resultXdr) : { txCode: "unknown", perOperation: [] };
  return {
    status: res.status === rpc.Api.GetTransactionStatus.SUCCESS ? "SUCCESS" : "FAILED",
    hash,
    txCode,
    resultXdr: res.resultXdr?.toXDR("base64"),
    ledger: res.ledger,
    perOperation,
  };
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * Submits an envelope whose hash has already been persisted. Always
 * looks the hash up first, so a retry after a crash can never submit
 * twice what already landed, then polls until the ledger answers.
 */
export async function submitPersisted(network: Network, envelopeXdr: string): Promise<SubmitOutcome> {
  const passphrase = getNetworkPassphrase(network);
  const envelope = TransactionBuilder.fromXDR(envelopeXdr, passphrase);
  const hash = envelope.hash().toString("hex");

  const known = await lookupTransaction(network, hash);
  if (known) return known;

  const server = getRpcServer(network);
  for (let attempt = 0; ; attempt++) {
    const sent = await server.sendTransaction(envelope);
    if (sent.status === "ERROR") {
      const { txCode, perOperation } = sent.errorResult ? describeResult(sent.errorResult) : { txCode: "unknown", perOperation: [] };
      return { status: "REJECTED", hash, txCode, perOperation };
    }
    if (sent.status === "TRY_AGAIN_LATER") {
      if (attempt + 1 >= TRY_AGAIN_ATTEMPTS) return { status: "TIMEOUT", hash, txCode: "TRY_AGAIN_LATER", perOperation: [] };
      await sleep(POLL_INTERVAL_MS * 2 ** attempt);
      continue;
    }
    break; // PENDING or DUPLICATE: it is in flight, wait for it.
  }

  const deadline = Date.now() + POLL_TIMEOUT_MS;
  while (Date.now() < deadline) {
    await sleep(POLL_INTERVAL_MS);
    const outcome = await lookupTransaction(network, hash);
    if (outcome) return outcome;
  }
  return { status: "TIMEOUT", hash, perOperation: [] };
}
