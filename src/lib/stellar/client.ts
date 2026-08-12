import { Networks, rpc } from "@stellar/stellar-sdk";
import type { Network } from "@/generated/prisma/enums";

// SDF only runs a free public RPC for Testnet. Mainnet has no single
// official free RPC — set NEXT_PUBLIC_MAINNET_RPC_URL to a provider
// (e.g. a validator from https://stellarbeat.io, or a paid provider).
export const NETWORK_CONFIG: Record<
  Network,
  { passphrase: string; rpcUrl: string; horizonUrl: string; friendbot?: string }
> = {
  TESTNET: {
    passphrase: Networks.TESTNET,
    rpcUrl: "https://soroban-testnet.stellar.org",
    horizonUrl: "https://horizon-testnet.stellar.org",
    friendbot: "https://friendbot.stellar.org",
  },
  PUBLIC: {
    passphrase: Networks.PUBLIC,
    rpcUrl: process.env.NEXT_PUBLIC_MAINNET_RPC_URL ?? "",
    horizonUrl: "https://horizon.stellar.org",
  },
};

export function getRpcServer(network: Network): rpc.Server {
  return new rpc.Server(NETWORK_CONFIG[network].rpcUrl);
}

export function getNetworkPassphrase(network: Network): string {
  return NETWORK_CONFIG[network].passphrase;
}
