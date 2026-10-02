import type { Horizon } from "@stellar/stellar-sdk";
import type { Network } from "@/generated/prisma/enums";
import { getHorizonServer } from "@/lib/stellar/client";
import { DistributionError } from "./errors";

// Stellar caps an account at 20 signers besides its master key.
export const MAX_ADDITIONAL_SIGNERS = 20;
const MAX_SIGNER_WEIGHT = 255;

export type AccountAuthority = {
  accountId: string;
  thresholds: { low: number; medium: number; high: number };
  masterWeight: number;
  // Every signer except the master key, as Horizon lists them.
  additionalSigners: { key: string; weight: number; type: string }[];
};

export type AuthorityPlan = {
  freeSignerSlots: number;
  // Weight given to each temporary preAuthTx signer. Payments, account
  // creation and claimable balance creation are medium-threshold
  // operations, so the signer must reach the medium threshold on its
  // own, and never less than 1 (a weight-0 signer authorizes nothing).
  preAuthWeight: number;
  walletWeight: number;
};

export function authorityFromHorizon(account: Pick<Horizon.AccountResponse, "account_id" | "thresholds" | "signers">): AccountAuthority {
  const master = account.signers.find((s) => s.key === account.account_id);
  return {
    accountId: account.account_id,
    thresholds: {
      low: account.thresholds.low_threshold,
      medium: account.thresholds.med_threshold,
      high: account.thresholds.high_threshold,
    },
    masterWeight: master?.weight ?? 0,
    additionalSigners: account.signers
      .filter((s) => s.key !== account.account_id)
      .map((s) => ({ key: s.key, weight: s.weight, type: s.type })),
  };
}

// Decides, before anything is signed, whether one wallet signature can
// install `requiredSlots` preAuthTx signers on this account, and with
// what weight. The setup transaction is sourced from the account and
// carries SetOptions with a signer change, which needs the high
// threshold, so the wallet's key alone must reach it.
export function planAuthority(
  authority: AccountAuthority,
  requiredSlots: number,
  walletKey: string = authority.accountId
): AuthorityPlan {
  const freeSignerSlots = MAX_ADDITIONAL_SIGNERS - authority.additionalSigners.length;
  if (requiredSlots > freeSignerSlots) {
    throw new DistributionError(
      "INSUFFICIENT_SIGNER_SLOTS",
      `This distribution needs ${requiredSlots} temporary signer slot${requiredSlots === 1 ? "" : "s"} on your account, but only ${freeSignerSlots} of ${MAX_ADDITIONAL_SIGNERS} are free. Remove unused signers or send a smaller list.`,
      { requiredSlots, freeSignerSlots }
    );
  }

  const walletWeight =
    walletKey === authority.accountId
      ? authority.masterWeight
      : (authority.additionalSigners.find((s) => s.key === walletKey)?.weight ?? 0);
  const { low, medium, high } = authority.thresholds;
  const needed = Math.max(low, medium, high);
  if (walletWeight === 0 || walletWeight < needed) {
    throw new DistributionError(
      "UNSUPPORTED_MULTISIG",
      `This account needs more than one signature to change its signers (wallet key weight ${walletWeight}, high threshold ${high}). Multi-signature accounts are not supported.`,
      { walletWeight, thresholds: authority.thresholds }
    );
  }

  const preAuthWeight = Math.max(medium, 1);
  if (preAuthWeight > MAX_SIGNER_WEIGHT) {
    // Thresholds are a single byte, so this cannot happen on a valid
    // account; guard anyway rather than build an invalid SetOptions.
    throw new DistributionError("UNSUPPORTED_MULTISIG", "Account medium threshold is out of range.", { medium });
  }

  return { freeSignerSlots, preAuthWeight, walletWeight };
}

export async function loadAccountAuthority(network: Network, accountId: string): Promise<AccountAuthority> {
  try {
    const account = await getHorizonServer(network).loadAccount(accountId);
    return authorityFromHorizon(account);
  } catch (err) {
    if ((err as { response?: { status?: number } }).response?.status === 404) {
      throw new DistributionError("ACCOUNT_NOT_FOUND", `Account ${accountId} does not exist on ${network}.`);
    }
    throw err;
  }
}
