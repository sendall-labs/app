"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useWallet } from "@/components/wallet/WalletProvider";
import { ConnectButton } from "@/components/wallet/ConnectButton";

type AddressListSummary = {
  id: string;
  name: string;
  updatedAt: string;
  _count: { entries: number };
};

export default function AddressListsPage() {
  const { address } = useWallet();
  const [lists, setLists] = useState<AddressListSummary[] | null>(null);

  useEffect(() => {
    // JSX below branches on `address` first, so no need to clear stale
    // list state here when there's no wallet.
    if (!address) return;
    fetch("/api/address-lists")
      .then((res) => res.json())
      .then((data) => setLists(data.lists ?? []));
  }, [address]);

  return (
    <div className="flex flex-col gap-8">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="font-serif text-2xl font-semibold text-ink">Address Lists</h1>
          <p className="mt-1 text-sm text-ink-muted">
            Save name + address pairs to start batches from later.
          </p>
        </div>
        {address && (
          <Link
            href="/address-lists/new"
            className="rounded-md bg-accent px-4 py-2 text-sm font-medium text-accent-ink hover:bg-accent-hover"
          >
            New list
          </Link>
        )}
      </div>

      {!address ? (
        <div className="rounded-lg border border-hairline bg-surface px-5 py-8 text-center">
          <p className="text-sm text-ink-muted">Connect your wallet to save and reuse address lists.</p>
          <div className="mt-4 flex justify-center">
            <ConnectButton />
          </div>
        </div>
      ) : !lists ? (
        <p className="rounded-lg border border-hairline bg-surface px-5 py-8 text-sm text-ink-muted">
          Loading…
        </p>
      ) : lists.length === 0 ? (
        <p className="rounded-lg border border-hairline bg-surface px-5 py-8 text-sm text-ink-muted">
          No address lists yet —{" "}
          <Link href="/address-lists/new" className="text-accent hover:underline">
            create one
          </Link>
          .
        </p>
      ) : (
        <div className="rounded-lg border border-hairline bg-surface">
          <ul className="divide-y divide-hairline">
            {lists.map((list) => (
              <li key={list.id}>
                <Link
                  href={`/address-lists/${list.id}`}
                  className="flex items-center justify-between px-5 py-3 hover:bg-sidebar"
                >
                  <span className="font-medium text-ink">{list.name}</span>
                  <span className="text-xs text-ink-muted">{list._count.entries} addresses</span>
                </Link>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
