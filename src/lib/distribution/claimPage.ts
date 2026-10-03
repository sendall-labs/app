import { Asset, BASE_FEE, FeeBumpTransaction, Operation, TransactionBuilder, type Transaction } from "@stellar/stellar-sdk";
import type { Network } from "@/generated/prisma/enums";
import { prisma } from "@/lib/db/prisma";
import { getHorizonServer, getNetworkPassphrase, getRpcServer } from "@/lib/stellar/client";
import { submitAndPoll } from "@/lib/stellar/submit";
import { DistributionError } from "./errors";

// Horizon's JSON form of a claim predicate.
export type HorizonPredicate = {
  unconditional?: boolean;
  abs_before?: string;
  rel_before?: string;
  not?: HorizonPredicate;
  and?: HorizonPredicate[];
  or?: HorizonPredicate[];
};

/** Whether a predicate lets its claimant claim at `now`. `createdAt` anchors relative predicates. */
export function predicateOpen(p: HorizonPredicate, now: Date, createdAt: Date): boolean {
  if (p.unconditional) return true;
  if (p.abs_before) return now.getTime() < new Date(p.abs_before).getTime();
  if (p.rel_before) return now.getTime() < createdAt.getTime() + Number(p.rel_before) * 1000;
  if (p.not) return !predicateOpen(p.not, now, createdAt);
  if (p.and) return p.and.every((q) => predicateOpen(q, now, createdAt));
  if (p.or) return p.or.some((q) => predicateOpen(q, now, createdAt));
  return false;
}

/** The deadline in a "claim before T" predicate, if it is one. */
function deadlineOf(p: HorizonPredicate): string | null {
  return p.abs_before ?? null;
}

export type ClaimableItem = {
  id: string;
  assetCode: string;
  assetIssuer: string | null;
  amount: string;
  claimableUntil: string | null;
  needsTrustline: boolean;
  fromBatch: boolean;
};

export type ClaimableList = {
  address: string;
  network: Network;
  accountExists: boolean;
  items: ClaimableItem[];
};

function parseAsset(asset: string): { code: string; issuer: string | null } {
  if (asset === "native") return { code: "XLM", issuer: null };
  const [code, issuer] = asset.split(":");
  return { code, issuer };
}

/**
 * Everything waiting for `address` that it can claim right now. With a
 * batch id, that batch's balances come first and are flagged.
 */
export async function listClaimable(network: Network, address: string, batchId?: string): Promise<ClaimableList> {
  const horizon = getHorizonServer(network);
  const now = new Date();

  let held = new Set<string>();
  let accountExists = true;
  try {
    const account = await horizon.loadAccount(address);
    held = new Set(
      account.balances
        .filter((b): b is typeof b & { asset_code: string; asset_issuer: string } => "asset_code" in b && "asset_issuer" in b)
        .map((b) => `${b.asset_code}:${b.asset_issuer}`)
    );
  } catch (err) {
    if ((err as { response?: { status?: number } }).response?.status !== 404) throw err;
    accountExists = false;
  }

  const page = await horizon.claimableBalances().claimant(address).limit(200).call();
  const batchIds = batchId
    ? new Set(
        (await prisma.recipient.findMany({ where: { batchId, claimableBalanceId: { not: null } }, select: { claimableBalanceId: true } })).map(
          (r) => r.claimableBalanceId!
        )
      )
    : new Set<string>();

  const items: ClaimableItem[] = [];
  for (const b of page.records) {
    const mine = b.claimants.find((c) => c.destination === address);
    if (!mine) continue;
    const predicate = mine.predicate as HorizonPredicate;
    if (!predicateOpen(predicate, now, new Date((b as { last_modified_time?: string }).last_modified_time ?? now))) continue;
    const { code, issuer } = parseAsset(b.asset);
    items.push({
      id: b.id,
      assetCode: code,
      assetIssuer: issuer,
      amount: b.amount,
      claimableUntil: deadlineOf(predicate),
      needsTrustline: !!issuer && issuer !== address && !held.has(`${code}:${issuer}`),
      fromBatch: batchIds.has(b.id),
    });
  }
  items.sort((a, b) => Number(b.fromBatch) - Number(a.fromBatch));
  return { address, network, accountExists, items };
}

const MAX_OPS = 100;

/**
 * One transaction from the recipient's own account: a trustline for each
 * asset it does not hold yet, then a claim per balance. The recipient
 * signs and pays its own fee.
 */
export async function buildClaimTx(network: Network, address: string, balanceIds: string[]): Promise<{ xdr: string; operationCount: number }> {
  const unique = [...new Set(balanceIds)];
  if (unique.length === 0) throw new DistributionError("PREFLIGHT_FAILED", "Choose at least one balance to claim.");
  const list = await listClaimable(network, address);
  if (!list.accountExists) {
    throw new DistributionError("ACCOUNT_NOT_FOUND", "Your account is not active yet. Add some XLM to it first, then claim.");
  }
  const chosen = unique.map((id) => list.items.find((i) => i.id === id));
  if (chosen.some((i) => !i)) throw new DistributionError("PREFLIGHT_FAILED", "One of these balances is no longer claimable by this account.");

  const trustlines = new Map<string, Asset>();
  for (const item of chosen as ClaimableItem[]) {
    if (item.needsTrustline) trustlines.set(`${item.assetCode}:${item.assetIssuer}`, new Asset(item.assetCode, item.assetIssuer!));
  }
  const operationCount = trustlines.size + chosen.length;
  if (operationCount > MAX_OPS) {
    throw new DistributionError("PREFLIGHT_FAILED", `Claim at most ${MAX_OPS - trustlines.size} balances at a time.`);
  }

  const account = await getRpcServer(network).getAccount(address);
  const builder = new TransactionBuilder(account, { fee: BASE_FEE, networkPassphrase: getNetworkPassphrase(network) }).setTimeout(300);
  for (const asset of trustlines.values()) builder.addOperation(Operation.changeTrust({ asset }));
  for (const item of chosen as ClaimableItem[]) builder.addOperation(Operation.claimClaimableBalance({ balanceId: item.id }));
  return { xdr: builder.build().toXDR(), operationCount };
}

/**
 * Submits a claim the recipient signed. Only trustline and claim
 * operations from the signer's own account are relayed, so this endpoint
 * cannot be used to push arbitrary transactions through Sendall.
 */
export async function submitClaimTx(network: Network, signedXdr: string) {
  let tx: Transaction | FeeBumpTransaction;
  try {
    tx = TransactionBuilder.fromXDR(signedXdr, getNetworkPassphrase(network));
  } catch {
    throw new DistributionError("SETUP_MISMATCH", "Unreadable transaction.");
  }
  if (tx instanceof FeeBumpTransaction) throw new DistributionError("SETUP_MISMATCH", "Unexpected fee bump.");
  const allowed = tx.operations.every(
    (op) => (op.type === "changeTrust" || op.type === "claimClaimableBalance") && (op.source === undefined || op.source === tx.source)
  );
  if (!allowed || tx.operations.length === 0) throw new DistributionError("SETUP_MISMATCH", "Only claims can be submitted here.");

  const result = await submitAndPoll(network, signedXdr);
  if (result.status === "SUCCESS") {
    const ids = tx.operations.flatMap((op) => (op.type === "claimClaimableBalance" ? [op.balanceId] : []));
    await prisma.recipient.updateMany({
      where: { claimableBalanceId: { in: ids }, claimStatus: "UNCLAIMED" },
      data: { claimStatus: "CLAIMED", claimTxHash: result.hash, claimedAt: new Date() },
    });
  }
  return { status: result.status, hash: result.hash, perOperation: result.perOperation };
}
