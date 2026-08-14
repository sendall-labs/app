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

  const handleLogout = useCallback(async () => {
    await fetch("/api/auth/logout", { method: "POST" });
    setSession(null);
  }, []);

  if (session) {
    return (
      <button
        onClick={handleLogout}
        className="rounded-md border border-neutral-300 px-4 py-2 text-sm font-medium hover:bg-neutral-100 dark:border-neutral-700 dark:hover:bg-neutral-800"
      >
        {truncate(session)} · Disconnect
      </button>
    );
  }

  return (
    <button
      onClick={handleLogin}
      disabled={loading}
      className="rounded-md bg-neutral-900 px-4 py-2 text-sm font-medium text-white hover:bg-neutral-700 disabled:opacity-50 dark:bg-white dark:text-neutral-900"
    >
      {loading ? "Connecting…" : "Connect Wallet"}
    </button>
  );
}
