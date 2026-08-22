"use client";

import { useState } from "react";
import { toast } from "sonner";
import { useWallet } from "@/components/wallet/WalletProvider";

type CheckResult = {
  name: string;
  address: string;
  accountExists: boolean;
  currentBalance: string | null;
  hasTrustline: boolean | null;
  ok: boolean;
  reason?: string;
};

const EXAMPLE = [
  "GDM5TPUTB7A7UW4QJ5SGUVA7WVJCNOHZO5RZIYM2Y4B3MJQB3F6CGOC5",
  "GBRPYHIL2CI3FNQ4BXLFMNDLFJUNPU2HY3ZMFSHONUCEOASW7QC7OX2H",
].join("\n");

export default function CheckBalancePage() {
  const { network: walletNetwork } = useWallet();
  const [network, setNetwork] = useState(walletNetwork);
  const [text, setText] = useState("");
  const [assetCode, setAssetCode] = useState("");
  const [assetIssuer, setAssetIssuer] = useState("");
  const [busy, setBusy] = useState(false);
  const [results, setResults] = useState<CheckResult[] | null>(null);

  const handleCheck = async () => {
    if (!text.trim()) {
      toast.error("Paste at least one address");
      return;
    }
    setBusy(true);
    try {
      const res = await fetch("/api/check-balance", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          text,
          network,
          assetCode: assetCode.trim() || undefined,
          assetIssuer: assetIssuer.trim() || undefined,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Check failed");
      setResults(data.results);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Check failed");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight text-ink">Check Balance</h1>
        <p className="mt-1 text-sm text-ink-muted">
          Bulk-check whether addresses exist, hold a trustline, and their balance. No wallet needed.
        </p>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <div className="flex flex-col gap-2">
          <label className="text-sm font-medium text-ink" htmlFor="cb-network">
            Network
          </label>
          <select
            id="cb-network"
            value={network}
            onChange={(e) => setNetwork(e.target.value as typeof network)}
            className="rounded-xl border border-hairline bg-paper px-3 py-2 text-sm text-ink outline-none focus:border-accent"
          >
            <option value="TESTNET">Testnet</option>
            <option value="PUBLIC">Public (Mainnet)</option>
          </select>
        </div>
        <div className="flex flex-col gap-2">
          <label className="text-sm font-medium text-ink" htmlFor="cb-asset-code">
            Asset (blank = native XLM)
          </label>
          <div className="flex gap-2">
            <input
              id="cb-asset-code"
              value={assetCode}
              onChange={(e) => setAssetCode(e.target.value)}
              placeholder="Code (e.g. USDC)"
              className="w-1/3 rounded-xl border border-hairline bg-paper px-3 py-2 text-sm text-ink outline-none focus:border-accent"
            />
            <input
              value={assetIssuer}
              onChange={(e) => setAssetIssuer(e.target.value)}
              placeholder="Issuer address"
              className="flex-1 rounded-xl border border-hairline bg-paper px-3 py-2 font-mono text-sm text-ink outline-none focus:border-accent"
            />
          </div>
        </div>
      </div>

      <div className="flex flex-col gap-2">
        <div className="flex items-center justify-between">
          <label className="text-sm font-medium text-ink" htmlFor="cb-text">
            Addresses
          </label>
          <button
            type="button"
            onClick={() => setText(EXAMPLE)}
            className="cursor-pointer text-xs text-accent hover:underline"
          >
            Show example
          </button>
        </div>
        <textarea
          id="cb-text"
          value={text}
          onChange={(e) => setText(e.target.value)}
          rows={8}
          placeholder={"name,address\nAlice,G...\nG... (name optional)"}
          className="rounded-xl border border-hairline bg-paper px-3 py-2 font-mono text-sm text-ink outline-none focus:border-accent"
        />
        <p className="text-xs text-ink-faint">One per line: name,address — or just an address.</p>
      </div>

      <div>
        <button
          type="button"
          onClick={handleCheck}
          disabled={busy}
          className="accent-gradient cursor-pointer rounded-full px-4 py-2 text-sm font-medium text-white shadow-sm transition-transform hover:scale-[1.03] disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:scale-100"
        >
          {busy ? "Checking…" : "Check balances"}
        </button>
      </div>

      {results && (
        <div className="rounded-2xl border border-hairline bg-surface shadow-sm">
          {results.length === 0 ? (
            <p className="px-5 py-8 text-sm text-ink-muted">No valid addresses to check.</p>
          ) : (
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-hairline text-left text-xs uppercase tracking-wide text-ink-faint">
                  <th className="px-5 py-3 font-medium">Name</th>
                  <th className="px-5 py-3 font-medium">Address</th>
                  <th className="px-5 py-3 font-medium">Exists</th>
                  <th className="px-5 py-3 font-medium">Trustline</th>
                  <th className="px-5 py-3 font-medium">Balance</th>
                  <th className="px-5 py-3 font-medium">Note</th>
                </tr>
              </thead>
              <tbody>
                {results.map((r) => (
                  <tr key={r.address} className="border-b border-hairline last:border-0">
                    <td className="px-5 py-3 text-ink">{r.name}</td>
                    <td className="px-5 py-3 font-mono text-xs text-ink-muted">{r.address}</td>
                    <td className="px-5 py-3">
                      <span
                        className={`rounded-full px-2.5 py-1 text-xs font-medium ${
                          r.accountExists ? "bg-success-soft text-success" : "bg-danger-soft text-danger"
                        }`}
                      >
                        {r.accountExists ? "Yes" : "No"}
                      </span>
                    </td>
                    <td className="px-5 py-3 text-ink-muted">
                      {r.hasTrustline === null ? "—" : r.hasTrustline ? "Yes" : "No"}
                    </td>
                    <td className="px-5 py-3 tabular-nums text-ink-muted">{r.currentBalance ?? "—"}</td>
                    <td className="px-5 py-3 text-xs text-ink-faint">{r.reason ?? ""}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      )}
    </div>
  );
}
