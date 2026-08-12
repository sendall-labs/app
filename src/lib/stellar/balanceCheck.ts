import { Asset, xdr } from "@stellar/stellar-sdk";
import type { Network } from "@/generated/prisma/enums";
import { getRpcServer } from "./client";

// SDF's soroban-testnet.stellar.org / equivalent providers accept up to
// 200 LedgerKeys per getLedgerEntries call.
const MAX_KEYS_PER_CALL = 200;
const MIN_ACCOUNT_RESERVE_XLM = 1; // base reserve for creating a new account

export type CheckTarget = {
  destination: string;
  amount: string;
};

export type CheckResult = {
  destination: string;
  accountExists: boolean;
  hasTrustline: boolean | null; // null = not applicable (native XLM)
  trustlineLimitOk: boolean | null;
  needsCreateAccount: boolean; // native XLM to a non-existent account
  ok: boolean;
  reason?: string;
};

function buildAccountKey(destinationEd25519RawPublicKey: Buffer) {
  const accountId = xdr.PublicKey.publicKeyTypeEd25519(
    destinationEd25519RawPublicKey
  );
  return xdr.LedgerKey.account(new xdr.LedgerKeyAccount({ accountId }));
}

function buildTrustlineKey(
  destinationEd25519RawPublicKey: Buffer,
  asset: Asset
) {
  const accountId = xdr.PublicKey.publicKeyTypeEd25519(
    destinationEd25519RawPublicKey
  );
  return xdr.LedgerKey.trustline(
    new xdr.LedgerKeyTrustLine({
      accountId,
      asset: asset.toTrustLineXDRObject(),
    })
  );
}

function chunk<T>(items: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

