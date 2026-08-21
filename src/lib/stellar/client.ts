import { Horizon, Networks, rpc } from "@stellar/stellar-sdk";
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
  const { rpcUrl } = NETWORK_CONFIG[network];
  if (!rpcUrl) {
    // `new rpc.Server("")` throws a bare "Invalid URL" with no context —
    // this is the actual cause every time, so say so instead of letting
    // that cryptic message reach the client.
    throw new Error(
      network === "PUBLIC"
        ? "Mainnet RPC isn't configured — set NEXT_PUBLIC_MAINNET_RPC_URL to a provider (SDF doesn't run a free public one for mainnet)."
        : `No RPC URL configured for ${network}.`
    );
  }
  return new rpc.Server(rpcUrl);
}

export function getNetworkPassphrase(network: Network): string {
  return NETWORK_CONFIG[network].passphrase;
}

// RPC has no "list every trustline this account holds" call — the Horizon
// account endpoint is the one place that returns the full `balances[]`
// array (native XLM plus every issued asset), which is what a dashboard
// needs.
export function getHorizonServer(network: Network): Horizon.Server {
  return new Horizon.Server(NETWORK_CONFIG[network].horizonUrl);
}
