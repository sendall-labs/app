"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useWallet } from "@/components/wallet/WalletProvider";
import { ConnectButton } from "@/components/wallet/ConnectButton";

type Balance = { assetCode: string; assetIssuer: string | null; balance: string };

type BatchSummary = {
  id: string;
  status: string;
  csvFileName: string | null;
  _count: { recipients: number };
};

function formatAmount(raw: string): string {
  const n = Number(raw);
  if (Number.isNaN(n)) return raw;
  return n.toLocaleString(undefined, { maximumFractionDigits: 2 });
}

export default function HomePage() {
  const { address, network } = useWallet();
  const [balances, setBalances] = useState<Balance[] | null>(null);
  const [balancesError, setBalancesError] = useState<string | null>(null);
  const [batches, setBatches] = useState<BatchSummary[] | null>(null);

  useEffect(() => {
    // Nothing to fetch, and the JSX below already branches on `address`
    // first — no need to clear stale balance state here.
    if (!address) return;
    let cancelled = false;
    fetch(`/api/wallet/balances?network=${network}`)
      .then(async (res) => {
        const data = await res.json();
        if (!res.ok) throw new Error(data.error ?? "Failed to load balances");
        if (cancelled) return;
        setBalances(data.balances);
        setBalancesError(null);
      })
      .catch((err) => {
        if (cancelled) return;
        setBalances(null);
        setBalancesError(err instanceof Error ? err.message : "Failed to load balances");
      });
    return () => {
      cancelled = true;
    };
  }, [address, network]);

  useEffect(() => {
    fetch("/api/batches")
      .then((res) => res.json())
      .then((data) => setBatches(data.batches ?? []));
  }, []);

  const recentBatches = (batches ?? []).slice(0, 5);

  return (
    <div className="flex flex-col gap-10">
      <div>
        <h1 className="font-serif text-2xl font-semibold text-ink">Home</h1>
        <p className="mt-1 text-sm text-ink-muted">
          Your wallet balances and recent batches, at a glance.
        </p>
      </div>

      <section>
        <h2 className="text-xs font-medium uppercase tracking-wide text-ink-faint">Balances</h2>
        <div className="mt-3">
          {!address ? (
            <div className="rounded-lg border border-hairline bg-surface px-5 py-8 text-center">
              <p className="text-sm text-ink-muted">Connect your wallet to see balances.</p>
              <div className="mt-4 flex justify-center">
                <ConnectButton />
              </div>
            </div>
          ) : balancesError ? (
            <p className="rounded-lg border border-hairline bg-surface px-5 py-4 text-sm text-danger">
              {balancesError}
            </p>
          ) : !balances ? (
            <p className="rounded-lg border border-hairline bg-surface px-5 py-4 text-sm text-ink-muted">
              Loading…
            </p>
          ) : balances.length === 0 ? (
            <p className="rounded-lg border border-hairline bg-surface px-5 py-4 text-sm text-ink-muted">
              No balances yet — this account isn&apos;t funded on{" "}
              {network === "PUBLIC" ? "the public network" : "testnet"}.
            </p>
          ) : (
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {balances.map((b) => (
                <div
                  key={`${b.assetCode}-${b.assetIssuer ?? "native"}`}
                  className="rounded-lg border border-hairline bg-surface px-5 py-4"
                >
                  <p className="text-xs uppercase tracking-wide text-ink-faint">{b.assetCode}</p>
                  <p className="mt-1 font-serif text-2xl font-semibold tabular-nums text-ink">
                    {formatAmount(b.balance)}
                  </p>
                </div>
              ))}
            </div>
          )}
        </div>
      </section>

      <section>
        <div className="flex items-center justify-between">
          <h2 className="text-xs font-medium uppercase tracking-wide text-ink-faint">Recent batches</h2>
          <Link href="/batches" className="text-xs text-accent hover:underline">
            View all
          </Link>
        </div>
        <div className="mt-3 rounded-lg border border-hairline bg-surface">
          {!batches ? (
            <p className="px-5 py-8 text-sm text-ink-muted">Loading…</p>
          ) : recentBatches.length === 0 ? (
            <p className="px-5 py-8 text-sm text-ink-muted">
              No batches yet —{" "}
              <Link href="/batches/new" className="text-accent hover:underline">
                start one
              </Link>
              .
            </p>
          ) : (
            <ul className="divide-y divide-hairline">
              {recentBatches.map((b) => (
                <li key={b.id}>
                  <Link
                    href={`/batches/${b.id}`}
                    className="flex items-center justify-between px-5 py-3 hover:bg-sidebar"
                  >
                    <span className="font-medium text-ink">{b.csvFileName ?? b.id}</span>
                    <span className="flex items-center gap-3 text-xs text-ink-muted">
                      <span>{b._count.recipients} recipients</span>
                      <span className="rounded-full bg-sidebar px-2 py-1">{b.status}</span>
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </div>
      </section>

      <div className="flex flex-wrap gap-3">
        <Link
          href="/batches/new"
          className="rounded-md bg-accent px-4 py-2 text-sm font-medium text-accent-ink hover:bg-accent-hover"
        >
          New batch
        </Link>
        <Link
          href="/check-balance"
          className="rounded-md border border-hairline px-4 py-2 text-sm font-medium text-ink hover:bg-sidebar"
        >
          Check balance
        </Link>
      </div>
    </div>
  );
}
