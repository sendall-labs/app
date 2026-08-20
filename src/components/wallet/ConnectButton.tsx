"use client";

import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { useWallet } from "./WalletProvider";

function truncate(address: string): string {
  return `${address.slice(0, 4)}…${address.slice(-4)}`;
}

export function ConnectButton() {
  const { connect, signMessage } = useWallet();
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
      const publicKey = await connect();

      const challengeRes = await fetch("/api/auth/challenge", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ publicKey }),
      });
      if (!challengeRes.ok) throw new Error("Could not build login challenge");
      const { message, token } = await challengeRes.json();

      const signedMessage = await signMessage(message);

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
      setSession(verifiedKey);
      toast.success("Wallet connected");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to connect wallet");
    } finally {
      setLoading(false);
    }
  }, [connect, signMessage]);

  const handleLogout = useCallback(async () => {
    await fetch("/api/auth/logout", { method: "POST" });
    setSession(null);
  }, []);

  if (session) {
    return (
      <button
        onClick={handleLogout}
        className="cursor-pointer rounded-md border border-hairline px-4 py-2 text-sm font-medium text-ink hover:bg-sidebar"
      >
        {truncate(session)} · Disconnect
      </button>
    );
  }

  return (
    <button
      onClick={handleLogin}
      disabled={loading}
      className="cursor-pointer rounded-md bg-accent px-4 py-2 text-sm font-medium text-accent-ink hover:bg-accent-hover disabled:cursor-not-allowed disabled:opacity-50"
    >
      {loading ? "Connecting…" : "Connect Wallet"}
    </button>
  );
}
