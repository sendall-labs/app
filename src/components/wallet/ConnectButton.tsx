"use client";

import { useCallback, useState } from "react";
import { toast } from "sonner";
import { useWallet } from "./WalletProvider";

function truncate(address: string): string {
  return `${address.slice(0, 4)}…${address.slice(-4)}`;
}

export function ConnectButton() {
  // `address` doubles as "authenticated" here — every path that sets it
  // (initial session restore, or `login`'s SIWS verify) implies a valid
  // `sendall_session` cookie; nothing calls the raw `connect` on its own
  // anymore (see ensureClaimed in the batch review page).
  const { address, login, disconnect } = useWallet();
  const [loading, setLoading] = useState(false);

  const handleLogin = useCallback(async () => {
    setLoading(true);
    try {
      await login();
      toast.success("Wallet connected");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to connect wallet");
    } finally {
      setLoading(false);
    }
  }, [login]);

  const handleLogout = useCallback(async () => {
    await fetch("/api/auth/logout", { method: "POST" });
    await disconnect();
  }, [disconnect]);

  if (address) {
    return (
      <button
        onClick={handleLogout}
        className="cursor-pointer rounded-full border border-hairline px-4 py-2 text-sm font-medium text-ink transition-colors hover:bg-sidebar"
      >
        {truncate(address)} · Disconnect
      </button>
    );
  }

  return (
    <button
      onClick={handleLogin}
      disabled={loading}
      className="accent-gradient cursor-pointer rounded-full px-4 py-2 text-sm font-medium text-white shadow-sm transition-transform hover:scale-[1.03] disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:scale-100"
    >
      {loading ? "Connecting…" : "Connect Wallet"}
    </button>
  );
}
