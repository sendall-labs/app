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
  warmUpWalletDetection();
}

// Freighter's isAvailable() check round-trips a postMessage to its content
// script, and the kit races that against a hard 1s timeout (see
// StellarWalletsKit.refreshSupportedWallets). Right after a fresh page load
// the content script sometimes isn't listening yet, so the *first* connect
// attempt loses that race and fails with "no wallet connected" even though
// the wallet is installed — a second attempt right after then succeeds
// because the extension is warm by then. Retry a few times in the
// background so the extension is already warm before the user's first
// real click, instead of making them click twice.
function warmUpWalletDetection(attempt = 0) {
  StellarWalletsKit.refreshSupportedWallets()
    .then((wallets) => {
      if (attempt < 4 && !wallets.some((w) => w.isAvailable)) {
        setTimeout(() => warmUpWalletDetection(attempt + 1), 400);
      }
    })
    .catch(() => {
      if (attempt < 4) setTimeout(() => warmUpWalletDetection(attempt + 1), 400);
    });
}

export { StellarWalletsKit, KitEventType } from "@creit.tech/stellar-wallets-kit";
