import type { Network } from "@/generated/prisma/enums";
import { getHorizonServer } from "@/lib/stellar/client";

const STROOPS_PER_UNIT = BigInt(10_000_000);

/** "12.3456789" -> 123456789n, exactly (no floating point). */
export function toStroops(amount: string): bigint {
  const [whole, frac = ""] = amount.trim().split(".");
  if (!/^\d+$/.test(whole) || !/^\d*$/.test(frac) || frac.length > 7) throw new Error(`Invalid amount ${amount}`);
  return BigInt(whole) * STROOPS_PER_UNIT + BigInt(frac.padEnd(7, "0"));
}

export function fromStroops(stroops: bigint): string {
  const negative = stroops < BigInt(0);
  const abs = negative ? -stroops : stroops;
  const whole = abs / STROOPS_PER_UNIT;
  const frac = (abs % STROOPS_PER_UNIT).toString().padStart(7, "0").replace(/0+$/, "");
  return `${negative ? "-" : ""}${whole}${frac ? `.${frac}` : ""}`;
}

/** The network's current base reserve, read from the latest ledger. */
export async function getBaseReserveStroops(network: Network): Promise<bigint> {
  const page = await getHorizonServer(network).ledgers().order("desc").limit(1).call();
  return BigInt(page.records[0].base_reserve_in_stroops);
}

// Each claimable balance carries two claimants (recipient, and the sender
// for reclaim), and the creator reserves one base reserve per claimant
// until the balance is claimed or reclaimed.
export const CLAIMANTS_PER_BALANCE = 2;

export function claimableBalanceReserve(count: number, baseReserve: bigint): bigint {
  return BigInt(count * CLAIMANTS_PER_BALANCE) * baseReserve;
}

export type AccountFunds = {
  nativeBalance: bigint;
  // What the account may spend without dropping under its minimum balance.
  spendableNative: bigint;
  assetBalance: bigint | null; // null = no trustline
  assetAuthorized: boolean;
};

export async function loadAccountFunds(
  network: Network,
  accountId: string,
  baseReserve: bigint,
  asset: { code: string; issuer: string } | null
): Promise<AccountFunds> {
  const account = await getHorizonServer(network).loadAccount(accountId);
  const native = account.balances.find((b) => b.asset_type === "native")!;
  const nativeBalance = toStroops(native.balance);
  const selling = toStroops((native as { selling_liabilities?: string }).selling_liabilities ?? "0");
  const entries = BigInt(2 + account.subentry_count + (account.num_sponsoring ?? 0) - (account.num_sponsored ?? 0));
  const spendableNative = nativeBalance - entries * baseReserve - selling;

  let assetBalance: bigint | null = null;
  let assetAuthorized = false;
  if (asset) {
    const line = account.balances.find(
      (b) => "asset_code" in b && b.asset_code === asset.code && "asset_issuer" in b && b.asset_issuer === asset.issuer
    ) as { balance: string; selling_liabilities?: string; is_authorized?: boolean } | undefined;
    if (line) {
      assetBalance = toStroops(line.balance) - toStroops(line.selling_liabilities ?? "0");
      assetAuthorized = line.is_authorized !== false;
    }
  }
  return { nativeBalance, spendableNative, assetBalance, assetAuthorized };
}
