"use client";

import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { BrandLogo } from "@/components/brand/BrandLogo";
import { useWallet } from "@/components/wallet/WalletProvider";
import { explorerTxUrl } from "@/lib/stellar/explorer";

type Item = {
  id: string;
  assetCode: string;
  assetIssuer: string | null;
  amount: string;
  claimableUntil: string | null;
  needsTrustline: boolean;
  fromBatch: boolean;
};

type List = { accountExists: boolean; items: Item[] };

function shortDate(iso: string) {
  return new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

function trim(amount: string) {
  return amount.replace(/\.?0+$/, "");
}

export function ClaimClient({ network, batchId }: { network: "TESTNET" | "PUBLIC"; batchId?: string }) {
  const { address, connect, connecting, setNetwork, signTransaction } = useWallet();
  const [list, setList] = useState<List | null>(null);
  const [loading, setLoading] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [claiming, setClaiming] = useState(false);
  const [lastHash, setLastHash] = useState<string | null>(null);

  useEffect(() => {
    setNetwork(network);
  }, [network, setNetwork]);

  const load = useCallback(
    async (who: string) => {
      setLoading(true);
      try {
        const qs = new URLSearchParams({ address: who, network, ...(batchId ? { batch: batchId } : {}) });
        const res = await fetch(`/api/claim?${qs}`);
        const data = await res.json();
        if (!res.ok) throw new Error(data.error ?? "Could not load your balances");
        setList(data);
        setSelected(new Set((data.items as Item[]).slice(0, 90).map((i) => i.id)));
      } catch (err) {
        toast.error(err instanceof Error ? err.message : "Could not load your balances");
      } finally {
        setLoading(false);
      }
    },
    [network, batchId]
  );

  useEffect(() => {
    if (!address) return;
    const timer = setTimeout(() => void load(address), 0);
    return () => clearTimeout(timer);
  }, [address, load]);

  const claim = useCallback(async () => {
    if (!address || selected.size === 0) return;
    setClaiming(true);
    try {
      const build = await fetch("/api/claim/build", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ address, network, balanceIds: [...selected] }),
      });
      const built = await build.json();
      if (!build.ok) throw new Error(built.error ?? "Could not prepare the claim");
      const signedXdr = await signTransaction(built.xdr);
      const submit = await fetch("/api/claim/submit", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ network, signedXdr }),
      });
      const result = await submit.json();
      if (!submit.ok || result.status !== "SUCCESS") throw new Error(result.error ?? "The claim did not go through");
      setLastHash(result.hash);
      toast.success("Claimed");
      await load(address);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "The claim did not go through");
    } finally {
      setClaiming(false);
    }
  }, [address, network, selected, signTransaction, load]);

  const items = list?.items ?? [];
  const chosen = items.filter((i) => selected.has(i.id));
  const newTrustlines = new Set(chosen.filter((i) => i.needsTrustline).map((i) => `${i.assetCode}:${i.assetIssuer}`)).size;

  return (
    <div className="min-h-screen bg-paper">
      <header className="mx-auto flex max-w-2xl items-center justify-between px-4 py-6">
        <BrandLogo />
        <span className={`rounded-full px-3 py-1 text-xs font-medium ${network === "PUBLIC" ? "bg-danger-soft text-danger" : "bg-sidebar text-ink-muted"}`}>
          {network === "PUBLIC" ? "Mainnet" : "Testnet"}
        </span>
      </header>

      <main className="mx-auto flex max-w-2xl flex-col gap-6 px-4 pb-16">
        <div>
          <h1 className="text-3xl font-semibold tracking-tight text-ink">Claim your funds</h1>
          <p className="mt-2 text-sm text-ink-muted">
            Someone set funds aside for you on Stellar. Connect the wallet they were sent to and claim them with one signature.
            If you do not hold the asset yet, the trustline is added in the same step.
          </p>
        </div>

        {!address ? (
          <button
            type="button"
            onClick={() => void connect().catch(() => toast.error("Wallet connection was cancelled"))}
            disabled={connecting}
            className="accent-gradient w-fit cursor-pointer rounded-full px-5 py-2.5 text-sm font-medium text-white shadow-sm disabled:opacity-50"
          >
            {connecting ? "Connecting…" : "Connect wallet"}
          </button>
        ) : (
          <section aria-label="Waiting for you" className="rounded-2xl border border-hairline bg-surface p-5 shadow-sm">
            <header className="flex items-baseline justify-between gap-2">
              <h2 className="text-base font-semibold text-ink">Waiting for you</h2>
              <span className="font-mono text-xs text-ink-faint">
                {address.slice(0, 4)}…{address.slice(-4)}
              </span>
            </header>

            {loading && !list && <p className="mt-4 text-sm text-ink-muted">Looking up your balances…</p>}

            {list && !list.accountExists && (
              <div className="mt-4 rounded-xl bg-warning-soft px-4 py-3 text-sm text-warning">
                This account is not active on {network === "PUBLIC" ? "Mainnet" : "Testnet"} yet. It needs at least 1 XLM
                {newTrustlines || items.some((i) => i.needsTrustline) ? ", plus 0.5 XLM for each new asset," : ""} before it can claim.
                {network === "TESTNET" && (
                  <>
                    {" "}
                    <a href={`https://friendbot.stellar.org?addr=${address}`} target="_blank" rel="noreferrer" className="font-medium underline">
                      Fund it with friendbot
                    </a>
                    , then refresh.
                  </>
                )}
              </div>
            )}

            {list && items.length === 0 && <p className="mt-4 text-sm text-ink-muted">Nothing is waiting for this account right now.</p>}

            {items.length > 0 && (
              <ul className="mt-4 flex flex-col gap-2">
                {items.map((item) => (
                  <li key={item.id}>
                    <label className="flex cursor-pointer items-center gap-3 rounded-xl border border-hairline bg-paper px-4 py-3 hover:border-accent">
                      <input
                        type="checkbox"
                        checked={selected.has(item.id)}
                        onChange={(e) =>
                          setSelected((prev) => {
                            const next = new Set(prev);
                            if (e.target.checked) next.add(item.id);
                            else next.delete(item.id);
                            return next;
                          })
                        }
                        className="h-4 w-4 accent-[var(--color-accent)]"
                      />
                      <span className="flex-1">
                        <span className="block text-sm font-medium text-ink">
                          {trim(item.amount)} {item.assetCode}
                        </span>
                        <span className="block text-xs text-ink-faint">
                          {item.claimableUntil ? `Claim before ${shortDate(item.claimableUntil)}` : "No deadline"}
                          {item.needsTrustline ? " · adds a trustline" : ""}
                          {item.fromBatch ? " · from this distribution" : ""}
                        </span>
                      </span>
                    </label>
                  </li>
                ))}
              </ul>
            )}

            {items.length > 0 && (
              <div className="mt-5 flex flex-wrap items-center justify-between gap-3">
                <p className="text-xs text-ink-faint">You sign and pay the network fee (a fraction of a cent).</p>
                <button
                  type="button"
                  onClick={() => void claim()}
                  disabled={claiming || chosen.length === 0 || !list?.accountExists}
                  className="accent-gradient cursor-pointer rounded-full px-5 py-2.5 text-sm font-medium text-white shadow-sm disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {claiming ? "Claiming…" : `Claim ${chosen.length}`}
                </button>
              </div>
            )}

            {lastHash && (
              <p className="mt-4 text-sm text-success">
                Claimed.{" "}
                <a href={explorerTxUrl(network, lastHash)} target="_blank" rel="noreferrer" className="font-mono underline">
                  View transaction
                </a>
              </p>
            )}
          </section>
        )}
      </main>
    </div>
  );
}
