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
        <h1 className="text-2xl font-semibold tracking-tight text-ink">Home</h1>
        <p className="mt-1 text-sm text-ink-muted">
          Your wallet balances and recent batches, at a glance.
        </p>
      </div>

      <section>
        <h2 className="text-xs font-medium uppercase tracking-wide text-ink-faint">Balances</h2>
        <div className="mt-3">
          {!address ? (
            <div className="rounded-2xl border border-hairline bg-surface shadow-sm px-5 py-8 text-center">
              <p className="text-sm text-ink-muted">Connect your wallet to see balances.</p>
              <div className="mt-4 flex justify-center">
                <ConnectButton />
              </div>
            </div>
          ) : balancesError ? (
            <p className="rounded-2xl border border-hairline bg-surface shadow-sm px-5 py-4 text-sm text-danger">
              {balancesError}
            </p>
          ) : !balances ? (
            <p className="rounded-2xl border border-hairline bg-surface shadow-sm px-5 py-4 text-sm text-ink-muted">
              Loading…
            </p>
          ) : balances.length === 0 ? (
            <p className="rounded-2xl border border-hairline bg-surface shadow-sm px-5 py-4 text-sm text-ink-muted">
              No balances yet — this account isn&apos;t funded on{" "}
              {network === "PUBLIC" ? "the public network" : "testnet"}.
            </p>
          ) : (
            <div className="grid gap-3 sm:grid-cols-3">
              {/* Primary balance (XLM if held, else whatever's first) gets the
                  hero treatment — a flat grid of equal boxes hid which
                  number actually matters. */}
              {balances
                .slice()
                .sort((a, b) => (a.assetCode === "XLM" ? -1 : b.assetCode === "XLM" ? 1 : 0))
                .map((b, i) => {
                  const key = `${b.assetCode}-${b.assetIssuer ?? "native"}`;
                  if (i === 0) {
                    return (
                      <div
                        key={key}
                        className="relative overflow-hidden rounded-2xl border border-hairline bg-surface px-6 py-6 shadow-sm sm:col-span-3"
                      >
                        <div
                          aria-hidden
                          className="pointer-events-none absolute inset-0 opacity-[0.08]"
                          style={{
                            backgroundImage:
                              "radial-gradient(circle at 85% 20%, var(--color-accent-2), transparent 60%), radial-gradient(circle at 10% 90%, var(--color-accent), transparent 55%)",
                          }}
                        />
                        <div className="relative flex items-center justify-between gap-4">
                          <div>
                            <div className="flex items-center gap-2">
                              <span className="accent-gradient flex h-6 w-6 items-center justify-center rounded-full text-[10px] font-bold text-white">
                                {b.assetCode.slice(0, 1)}
                              </span>
                              <p className="text-xs uppercase tracking-wide text-ink-faint">
                                {b.assetCode} · {network === "PUBLIC" ? "Public" : "Testnet"}
                              </p>
                            </div>
                            <p className="mt-2 text-4xl font-bold tracking-tight tabular-nums text-ink">
                              {formatAmount(b.balance)}
                            </p>
                          </div>
                        </div>
                      </div>
                    );
                  }
                  return (
                    <div
                      key={key}
                      className="rounded-2xl border border-hairline bg-surface px-5 py-4 shadow-sm transition-shadow hover:shadow-md"
                    >
                      <p className="text-xs uppercase tracking-wide text-ink-faint">{b.assetCode}</p>
                      <p className="mt-1 text-xl font-bold tracking-tight tabular-nums text-ink">
                        {formatAmount(b.balance)}
                      </p>
                    </div>
                  );
                })}
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
        <div className="mt-3 rounded-2xl border border-hairline bg-surface shadow-sm">
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
                    className="flex items-center justify-between px-5 py-3 transition-colors hover:bg-sidebar"
                  >
                    <span className="font-medium text-ink">{b.csvFileName ?? b.id}</span>
                    <span className="flex items-center gap-3 text-xs text-ink-muted">
                      <span>{b._count.recipients} recipients</span>
                      <span className="rounded-full bg-accent/10 px-2 py-1 text-accent">{b.status}</span>
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
          className="accent-gradient rounded-full px-4 py-2 text-sm font-medium text-white shadow-sm transition-transform hover:scale-[1.03]"
        >
          New batch
        </Link>
        <Link
          href="/check-balance"
          className="rounded-full border border-hairline px-4 py-2 text-sm font-medium text-ink transition-colors hover:bg-sidebar"
        >
          Check balance
        </Link>
      </div>
    </div>
  );
}
