"use client";

import { Networks as KitNetworks, StellarWalletsKit } from "@creit.tech/stellar-wallets-kit";
import { AlbedoModule } from "@creit.tech/stellar-wallets-kit/modules/albedo";
import { FreighterModule } from "@creit.tech/stellar-wallets-kit/modules/freighter";
import { HotWalletModule } from "@creit.tech/stellar-wallets-kit/modules/hotwallet";
import { LobstrModule } from "@creit.tech/stellar-wallets-kit/modules/lobstr";
import { RabetModule } from "@creit.tech/stellar-wallets-kit/modules/rabet";
import { xBullModule } from "@creit.tech/stellar-wallets-kit/modules/xbull";
import type { Network } from "@/generated/prisma/enums";

let initialized = false;

export function networkToKitNetwork(network: Network): KitNetworks {
  return network === "PUBLIC" ? KitNetworks.PUBLIC : KitNetworks.TESTNET;
}

/** Idempotent — safe to call from multiple components mounting in any order. */
export function initWalletKit(network: Network) {
  if (initialized) {
    StellarWalletsKit.setNetwork(networkToKitNetwork(network));
    return;
  }
  StellarWalletsKit.init({
    network: networkToKitNetwork(network),
    modules: [
      new FreighterModule(),
      new xBullModule(),
      new AlbedoModule(),
      new LobstrModule(),
      new RabetModule(),
      new HotWalletModule(),
    ],
  });
  initialized = true;
}

export { StellarWalletsKit, KitEventType } from "@creit.tech/stellar-wallets-kit";
