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
  currentBalance: string | null; // null = account/trustline doesn't exist
  hasTrustline: boolean | null; // null = not applicable (native XLM)
  trustlineLimitOk: boolean | null;
  needsCreateAccount: boolean; // native XLM to a non-existent account
  ok: boolean;
  reason?: string;
};

/** Formats raw stroops (1 XLM = 10,000,000 stroops) as a fixed 7-decimal string. */
function stroopsToXlmString(stroops: bigint): string {
  const stroopsPerXlm = BigInt(10_000_000);
  const negative = stroops < BigInt(0);
  const abs = negative ? -stroops : stroops;
  const whole = abs / stroopsPerXlm;
  const frac = (abs % stroopsPerXlm).toString().padStart(7, "0");
  return `${negative ? "-" : ""}${whole}.${frac}`;
}

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

/**
 * Bulk balance + trustline check for a list of recipients, using Stellar
 * RPC's getLedgerEntries batch lookup instead of one Horizon call per
 * account. Missing entries mean "account/trustline doesn't exist" — RPC
 * only returns entries that are present.
 */
export async function checkRecipients(
  network: Network,
  targets: CheckTarget[],
  asset: Asset | null // null = native XLM
): Promise<Map<string, CheckResult>> {
  const { Keypair, MuxedAccount, StrKey } = await import("@stellar/stellar-sdk");
  const server = getRpcServer(network);

  // Ledger entries are keyed by the underlying ed25519 account, not the
  // muxed (M...) id, so muxed destinations resolve to their base G address.
  const rawKeyByDestination = new Map<string, Buffer>();
  for (const t of targets) {
    const baseAddress = StrKey.isValidMed25519PublicKey(t.destination)
      ? MuxedAccount.fromAddress(t.destination, "0").baseAccount().accountId()
      : t.destination;
    rawKeyByDestination.set(t.destination, Keypair.fromPublicKey(baseAddress).rawPublicKey());
  }

  const keys: xdr.LedgerKey[] = [];
  const keyLookup = new Map<string, { destination: string; kind: "account" | "trustline" }>();

  for (const t of targets) {
    const raw = rawKeyByDestination.get(t.destination)!;
    const aKey = buildAccountKey(raw);
    keys.push(aKey);
    keyLookup.set(aKey.toXDR("base64"), { destination: t.destination, kind: "account" });

    if (asset) {
      const tKey = buildTrustlineKey(raw, asset);
      keys.push(tKey);
      keyLookup.set(tKey.toXDR("base64"), { destination: t.destination, kind: "trustline" });
    }
  }

  const foundAccounts = new Set<string>();
  const nativeBalances = new Map<string, bigint>();
  const trustlines = new Map<string, { balance: bigint; limit: bigint }>();

  for (const batch of chunk(keys, MAX_KEYS_PER_CALL)) {
    const { entries } = await server.getLedgerEntries(...batch);
    for (const entry of entries) {
      const meta = keyLookup.get(entry.key.toXDR("base64"));
      if (!meta) continue;
      if (meta.kind === "account") {
        foundAccounts.add(meta.destination);
        nativeBalances.set(meta.destination, BigInt(entry.val.account().balance().toString()));
      } else {
        const tl = entry.val.trustLine();
        trustlines.set(meta.destination, {
          balance: BigInt(tl.balance().toString()),
          limit: BigInt(tl.limit().toString()),
        });
      }
    }
  }

  const results = new Map<string, CheckResult>();
  for (const t of targets) {
    const accountExists = foundAccounts.has(t.destination);
    const amountStroops = BigInt(Math.round(Number(t.amount) * 1e7));

    if (!asset) {
      const needsCreateAccount = !accountExists;
      const ok =
        accountExists ||
        Number(t.amount) >= MIN_ACCOUNT_RESERVE_XLM;
      const nativeBalance = nativeBalances.get(t.destination);
      results.set(t.destination, {
        destination: t.destination,
        accountExists,
        currentBalance: nativeBalance !== undefined ? stroopsToXlmString(nativeBalance) : null,
        hasTrustline: null,
        trustlineLimitOk: null,
        needsCreateAccount,
        ok,
        reason: ok ? undefined : `New account needs >= ${MIN_ACCOUNT_RESERVE_XLM} XLM to be created`,
      });
      continue;
    }

    if (!accountExists) {
      results.set(t.destination, {
        destination: t.destination,
        accountExists: false,
        currentBalance: null,
        hasTrustline: false,
        trustlineLimitOk: false,
        needsCreateAccount: false,
        ok: false,
        reason: "Destination account does not exist",
      });
      continue;
    }

    const tl = trustlines.get(t.destination);
    const hasTrustline = !!tl;
    const trustlineLimitOk = hasTrustline
      ? tl!.balance + amountStroops <= tl!.limit
      : false;

    results.set(t.destination, {
      destination: t.destination,
      accountExists: true,
      currentBalance: tl ? stroopsToXlmString(tl.balance) : null,
      hasTrustline,
      trustlineLimitOk,
      needsCreateAccount: false,
      ok: hasTrustline && trustlineLimitOk,
      reason: !hasTrustline
        ? "No trustline for this asset"
        : !trustlineLimitOk
          ? "Payment would exceed trustline limit"
          : undefined,
    });
  }

  return results;
}
