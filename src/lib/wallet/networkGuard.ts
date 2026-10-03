import { Networks } from "@stellar/stellar-sdk";
import type { Network } from "@/generated/prisma/enums";

/** Which Sendall network a wallet's passphrase belongs to; null for anything else (futurenet, custom). */
export function networkFromPassphrase(passphrase: string | null | undefined): Network | null {
  if (passphrase === Networks.PUBLIC) return "PUBLIC";
  if (passphrase === Networks.TESTNET) return "TESTNET";
  return null;
}

const LABEL: Record<Network, string> = { PUBLIC: "Mainnet", TESTNET: "Testnet" };

/**
 * The message to show when the wallet is on a different network than the
 * batch, or null when it is safe to sign. An unknown wallet network
 * (wallets that cannot report it) is not blocked here: the server
 * rejects a signature made for the wrong network anyway, because the
 * network is part of the transaction hash.
 */
export function networkMismatch(expected: Network, walletPassphrase: string | null | undefined): string | null {
  if (!walletPassphrase) return null;
  const wallet = networkFromPassphrase(walletPassphrase);
  if (wallet === expected) return null;
  const where = wallet ? LABEL[wallet] : "another network";
  return `Your wallet is set to ${where}, but this distribution is on ${LABEL[expected]}. Switch the wallet to ${LABEL[expected]} and approve again.`;
}
