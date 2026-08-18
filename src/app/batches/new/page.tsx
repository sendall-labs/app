"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { useWallet } from "@/components/wallet/WalletProvider";
import { CSV_HEADER } from "@/components/batches/RecipientsEditor";
import { ConnectButton } from "@/components/wallet/ConnectButton";

/**
 * Not a form of its own — creates an empty batch and hands off to its
 * Prepare tab immediately, so "New batch" opens the real Prepare screen
 * (same page, same autosave, same everything) instead of a lookalike
 * pre-creation form that only pretended to be it.
 */
export default function NewBatchPage() {
  const router = useRouter();
  const { network, address } = useWallet();
  const [error, setError] = useState<string | null>(null);
  const createdRef = useRef(false);

  useEffect(() => {
    if (!address || createdRef.current) return;
    createdRef.current = true;

    (async () => {
      try {
        const res = await fetch("/api/batches", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ csvText: CSV_HEADER, network, sourceAccount: address }),
        });
        if (!res.ok) throw new Error((await res.json()).error ?? "Failed to create batch");
        const { batch } = await res.json();
        router.replace(`/batches/${batch.id}`);
      } catch (err) {
        createdRef.current = false;
        const message = err instanceof Error ? err.message : "Failed to create batch";
        setError(message);
        toast.error(message);
      }
    })();
  }, [address, network, router]);

  if (!address) {
    return (
      <div className="flex flex-col items-center gap-4 py-16 text-center">
        <p className="text-sm text-ink-muted">Connect and sign in with your wallet to start a new batch.</p>
        <ConnectButton />
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex flex-col items-center gap-4 py-16 text-center">
        <p className="text-sm text-danger">{error}</p>
        <button
          onClick={() => {
            setError(null);
            createdRef.current = false;
          }}
          className="rounded-md border border-hairline px-4 py-2 text-sm font-medium text-ink hover:bg-sidebar"
        >
          Try again
        </button>
      </div>
    );
  }

  return <p className="text-sm text-ink-muted">Creating batch…</p>;
}
