import { Keypair } from "@stellar/stellar-sdk";
import type { Network } from "@/generated/prisma/enums";

// M: Sendall's sponsor and fee account, one per network. It sponsors the
// reserve of the temporary preAuthTx signers a distribution installs on
// the sender and pays every fee through fee bumps. It never holds user
// funds and never gains authority over a user account.
//
// The secret comes from the host's secret store (env), never the
// database. Channel secrets, which are many and created at runtime, are
// the ones stored encrypted in the database (see lib/crypto/serviceKeys).

const SPONSOR_ENV: Record<Network, string> = {
  TESTNET: "SPONSOR_SECRET_TESTNET",
  PUBLIC: "SPONSOR_SECRET_PUBLIC",
};

export class ServiceAccountNotConfiguredError extends Error {
  constructor(network: Network) {
    super(`Sponsor account for ${network} is not configured (${SPONSOR_ENV[network]}).`);
    this.name = "ServiceAccountNotConfiguredError";
  }
}

export function getSponsorKeypair(network: Network): Keypair {
  const secret = process.env[SPONSOR_ENV[network]];
  if (!secret) throw new ServiceAccountNotConfiguredError(network);
  return Keypair.fromSecret(secret);
}

export function isSponsorConfigured(network: Network): boolean {
  return !!process.env[SPONSOR_ENV[network]];
}

export function sponsorEnvName(network: Network): string {
  return SPONSOR_ENV[network];
}
