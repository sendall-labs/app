"use client";

import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { useWallet } from "./WalletProvider";

function truncate(address: string): string {
  return `${address.slice(0, 4)}…${address.slice(-4)}`;
}

export function ConnectButton() {
  const { network, address, connect, signTransaction } = useWallet();
  const [session, setSession] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    fetch("/api/auth/session")
      .then((res) => res.json())
      .then((data) => setSession(data.publicKey))
      .catch(() => {});
  }, []);

  const handleLogin = useCallback(async () => {
    setLoading(true);
    try {
      const publicKey = address ?? (await connect());

      const challengeRes = await fetch("/api/auth/challenge", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ publicKey, network }),
      });
      if (!challengeRes.ok) throw new Error("Could not build login challenge");
      const { challenge } = await challengeRes.json();

      const signedChallenge = await signTransaction(challenge);

      const verifyRes = await fetch("/api/auth/verify", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ signedChallenge, network }),
      });
      if (!verifyRes.ok) {
        const { error } = await verifyRes.json();
        throw new Error(error ?? "Login verification failed");
      }
      const { publicKey: verifiedKey } = await verifyRes.json();
      setSession(verifiedKey);
      toast.success("Wallet connected");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to connect wallet");
    } finally {
      setLoading(false);
    }
  }, [address, connect, network, signTransaction]);

