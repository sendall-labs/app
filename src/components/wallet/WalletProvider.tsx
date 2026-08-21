"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import type { Network } from "@/generated/prisma/enums";
import { initWalletKit, networkToKitNetwork, StellarWalletsKit } from "@/lib/wallet/kit";

type WalletContextValue = {
  network: Network;
  setNetwork: (network: Network) => void;
  address: string | null;
  connecting: boolean;
  connect: () => Promise<string>;
  // Full SIWS handshake (connect + challenge + sign + verify) — the only
  // thing that actually establishes the `sendall_session` cookie. `connect`
  // alone just reads the wallet's address and does not authenticate.
  login: () => Promise<string>;
  disconnect: () => Promise<void>;
  signTransaction: (xdr: string) => Promise<string>;
  signMessage: (message: string) => Promise<string>;
};

const WalletContext = createContext<WalletContextValue | null>(null);

const DEFAULT_NETWORK: Network =
  (process.env.NEXT_PUBLIC_DEFAULT_NETWORK as Network | undefined) ?? "TESTNET";

export function WalletProvider({ children }: { children: React.ReactNode }) {
  const [network, setNetwork] = useState<Network>(DEFAULT_NETWORK);
  const [address, setAddress] = useState<string | null>(null);
  const [connecting, setConnecting] = useState(false);
  // Mirrors `address`, but updated synchronously — signTransaction/signMessage
  // read this instead of the `address` state so a signMessage call made right
  // after connect() (same tick, before React re-renders) doesn't see a stale
  // closure where address is still null.
  const addressRef = useRef<string | null>(null);

  const updateAddress = useCallback((next: string | null) => {
    addressRef.current = next;
    setAddress(next);
  }, []);

  useEffect(() => {
    initWalletKit(network);
  }, [network]);

  useEffect(() => {
    fetch("/api/auth/session")
      .then((res) => res.json())
      .then((data) => {
        if (data.publicKey) updateAddress(data.publicKey);
      })
      .catch(() => {});
  }, [updateAddress]);

  const connect = useCallback(async () => {
    setConnecting(true);
    try {
      try {
        // A wallet module may already be selected from earlier this session —
        // re-fetch its address straight from the wallet (no picker popup)
        // instead of trusting our possibly-stale cache, since the user may
        // have switched accounts in the extension since we last checked.
        const { address: liveAddress } = await StellarWalletsKit.fetchAddress();
        updateAddress(liveAddress);
        return liveAddress;
      } catch {
        // No wallet selected yet — fall through to the picker below.
      }
      const { address: connectedAddress } = await StellarWalletsKit.authModal();
      updateAddress(connectedAddress);
      return connectedAddress;
    } finally {
      setConnecting(false);
    }
  }, [updateAddress]);

  const login = useCallback(async () => {
    const publicKey = await connect();

    const challengeRes = await fetch("/api/auth/challenge", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ publicKey }),
    });
    if (!challengeRes.ok) throw new Error("Could not build login challenge");
    const { message, token } = await challengeRes.json();

    const { signedMessage } = await StellarWalletsKit.signMessage(message, {
      address: publicKey,
      networkPassphrase: networkToKitNetwork(network),
    });

    const verifyRes = await fetch("/api/auth/verify", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ publicKey, signedMessage, token }),
    });
    if (!verifyRes.ok) {
      const { error } = await verifyRes.json();
      throw new Error(error ?? "Login verification failed");
    }
    const { publicKey: verifiedKey } = await verifyRes.json();
    updateAddress(verifiedKey);
    return verifiedKey;
  }, [connect, network, updateAddress]);

  const disconnect = useCallback(async () => {
    await StellarWalletsKit.disconnect();
    updateAddress(null);
  }, [updateAddress]);

  const signTransaction = useCallback(
    async (xdr: string) => {
      const currentAddress = addressRef.current;
      if (!currentAddress) throw new Error("No wallet connected");
      const { signedTxXdr } = await StellarWalletsKit.signTransaction(xdr, {
        address: currentAddress,
        networkPassphrase: networkToKitNetwork(network),
      });
      return signedTxXdr;
    },
    [network]
  );

  const signMessage = useCallback(
    async (message: string) => {
      const currentAddress = addressRef.current;
      if (!currentAddress) throw new Error("No wallet connected");
      const { signedMessage } = await StellarWalletsKit.signMessage(message, {
        address: currentAddress,
        networkPassphrase: networkToKitNetwork(network),
      });
      return signedMessage;
    },
    [network]
  );

  const value = useMemo(
    () => ({
      network,
      setNetwork,
      address,
      connecting,
      connect,
      login,
      disconnect,
      signTransaction,
      signMessage,
    }),
    [network, address, connecting, connect, login, disconnect, signTransaction, signMessage]
  );

  return <WalletContext.Provider value={value}>{children}</WalletContext.Provider>;
}

export function useWallet(): WalletContextValue {
  const ctx = useContext(WalletContext);
  if (!ctx) throw new Error("useWallet must be used within a WalletProvider");
  return ctx;
}
