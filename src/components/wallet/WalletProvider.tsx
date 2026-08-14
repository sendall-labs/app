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

  const signTransaction = useCallback(
    async (xdr: string) => {
      if (!address) throw new Error("No wallet connected");
      const { signedTxXdr } = await StellarWalletsKit.signTransaction(xdr, {
        address,
        networkPassphrase: networkToKitNetwork(network),
      });
      return signedTxXdr;
    },
    [address, network]
  );

  const value = useMemo(
    () => ({ network, setNetwork, address, connecting, connect, disconnect, signTransaction }),
    [network, address, connecting, connect, disconnect, signTransaction]
  );

  return <WalletContext.Provider value={value}>{children}</WalletContext.Provider>;
}

export function useWallet(): WalletContextValue {
  const ctx = useContext(WalletContext);
  if (!ctx) throw new Error("useWallet must be used within a WalletProvider");
  return ctx;
}
