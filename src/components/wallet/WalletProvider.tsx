"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import type { Network } from "@/generated/prisma/enums";
import { initWalletKit, networkToKitNetwork, StellarWalletsKit } from "@/lib/wallet/kit";

type WalletContextValue = {
  network: Network;
  setNetwork: (network: Network) => void;
  address: string | null;
  connecting: boolean;
  connect: () => Promise<string>;
  disconnect: () => Promise<void>;
  signTransaction: (xdr: string) => Promise<string>;
};

const WalletContext = createContext<WalletContextValue | null>(null);

const DEFAULT_NETWORK: Network =
  (process.env.NEXT_PUBLIC_DEFAULT_NETWORK as Network | undefined) ?? "TESTNET";

export function WalletProvider({ children }: { children: React.ReactNode }) {
  const [network, setNetwork] = useState<Network>(DEFAULT_NETWORK);
  const [address, setAddress] = useState<string | null>(null);
  const [connecting, setConnecting] = useState(false);

  useEffect(() => {
    initWalletKit(network);
  }, [network]);

  const connect = useCallback(async () => {
    setConnecting(true);
    try {
      const { address: connectedAddress } = await StellarWalletsKit.authModal();
      setAddress(connectedAddress);
      return connectedAddress;
    } finally {
      setConnecting(false);
    }
  }, []);

  const disconnect = useCallback(async () => {
    await StellarWalletsKit.disconnect();
    setAddress(null);
  }, []);

