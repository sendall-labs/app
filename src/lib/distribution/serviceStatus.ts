import type { Network } from "@/generated/prisma/enums";
import { prisma } from "@/lib/db/prisma";
import { NETWORK_CONFIG } from "@/lib/stellar/client";
import { getSponsorKeypair, isSponsorConfigured } from "@/lib/stellar/serviceAccounts";
import { feeCapPerOp } from "./feeBump";
import { fromStroops, getBaseReserveStroops, loadAccountFunds } from "./reserve";

// Below this the sponsor is flagged as running low (it still serves runs
// it can cover; preflight checks each run exactly).
const LOW_SPONSOR_XLM: Record<Network, bigint> = { TESTNET: BigInt(100 * 1e7), PUBLIC: BigInt(50 * 1e7) };

export type ServiceStatus = {
  network: Network;
  ready: boolean;
  reasons: string[];
  rpcConfigured: boolean;
  sponsorConfigured: boolean;
  sponsorSpendableXlm: string | null;
  sponsorLow: boolean;
  channelsAvailable: number;
  channelsTotal: number;
  feeCapStroopsPerOp: string;
};

/**
 * Whether Sendall can send on a network right now: RPC configured, a
 * funded sponsor, and channels in the pool. Shown before a sender
 * prepares anything, so Mainnet simply reads "not available yet" until
 * an operator has set it up.
 */
export async function serviceStatus(network: Network): Promise<ServiceStatus> {
  const reasons: string[] = [];
  const rpcConfigured = !!NETWORK_CONFIG[network].rpcUrl;
  if (!rpcConfigured) reasons.push("RPC endpoint is not configured.");

  const sponsorConfigured = isSponsorConfigured(network);
  let sponsorSpendableXlm: string | null = null;
  let sponsorLow = false;
  if (!sponsorConfigured) {
    reasons.push("Sponsor account is not configured.");
  } else {
    try {
      const funds = await loadAccountFunds(network, getSponsorKeypair(network).publicKey(), await getBaseReserveStroops(network), null);
      sponsorSpendableXlm = fromStroops(funds.spendableNative);
      sponsorLow = funds.spendableNative < LOW_SPONSOR_XLM[network];
      if (funds.spendableNative <= BigInt(0)) reasons.push("Sponsor account has no spendable XLM.");
    } catch {
      reasons.push("Sponsor account is not active on this network.");
    }
  }

  const [channelsAvailable, channelsTotal] = await Promise.all([
    prisma.channelAccount.count({ where: { network, status: "AVAILABLE" } }),
    prisma.channelAccount.count({ where: { network } }),
  ]);
  if (channelsTotal === 0) reasons.push("No channel accounts are provisioned.");

  return {
    network,
    ready: reasons.length === 0,
    reasons,
    rpcConfigured,
    sponsorConfigured,
    sponsorSpendableXlm,
    sponsorLow,
    channelsAvailable,
    channelsTotal,
    feeCapStroopsPerOp: feeCapPerOp(network).toString(),
  };
}
