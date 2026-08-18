"use client";

import { useCallback, useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { useWallet } from "@/components/wallet/WalletProvider";

function countCsvRows(text: string): number {
  const lines = text.split(/\r?\n/).filter((line) => line.trim().length > 0);
  return Math.max(0, lines.length - 1); // minus header row
}

const inputClass =
  "rounded-md border border-hairline bg-paper px-3 py-2 text-sm text-ink placeholder:text-ink-faint focus:border-accent focus:outline-none";

export default function NewBatchPage() {
  const router = useRouter();
  const { network, setNetwork, address } = useWallet();
  const [file, setFile] = useState<File | null>(null);
  const [rowCount, setRowCount] = useState<number | null>(null);
  const [assetCode, setAssetCode] = useState("");
  const [assetIssuer, setAssetIssuer] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const handleFileChange = useCallback(async (selected: File | null) => {
    setFile(selected);
    setRowCount(selected ? countCsvRows(await selected.text()) : null);
  }, []);

  const handleSubmit = useCallback(async () => {
    if (!address) {
      toast.error("Connect and sign in with your wallet first");
      return;
    }
    if (!file) {
      toast.error("Choose a CSV file first");
      return;
    }

    setSubmitting(true);
    try {
      const csvText = await file.text();
      const res = await fetch("/api/batches", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          csvText,
          csvFileName: file.name,
          network,
          sourceAccount: address,
          assetCode: assetCode || undefined,
          assetIssuer: assetIssuer || undefined,
        }),
      });
      if (!res.ok) {
        const { error } = await res.json();
        throw new Error(error ?? "Failed to create batch");
      }
      const { batch, parseErrors } = await res.json();
      if (parseErrors?.length) {
        toast.warning(`${parseErrors.length} row(s) skipped — missing destination/amount`);
      }
      router.push(`/batches/${batch.id}`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to create batch");
    } finally {
      setSubmitting(false);
    }
  }, [address, assetCode, assetIssuer, file, network, router]);

  return (
    <div className="flex max-w-xl flex-col gap-6">
      <div>
        <h1 className="font-serif text-2xl font-semibold text-ink">New batch</h1>
        <p className="mt-1 text-sm text-ink-muted">
          Upload a recipient list, pick a network and asset, then review before sending.
        </p>
      </div>

      <div className="rounded-lg border border-hairline bg-surface p-6">
        <div className="flex flex-col gap-2">
          <label className="text-sm font-medium text-ink">Recipients CSV</label>
          <input
            type="file"
            accept=".csv,text/csv"
            onChange={(e) => handleFileChange(e.target.files?.[0] ?? null)}
            className={inputClass}
          />
          <p className="text-xs text-ink-faint">
            Columns: <code>destination</code>, <code>amount</code>, optional <code>memo</code>.
          </p>
          {rowCount !== null && (
            <p className="text-xs text-ink-muted">
              {rowCount} recipient row{rowCount === 1 ? "" : "s"} detected.
            </p>
          )}
        </div>

        <div className="mt-6 flex flex-col gap-2">
          <label className="text-sm font-medium text-ink">Network</label>
          <select
            value={network}
            onChange={(e) => setNetwork(e.target.value as typeof network)}
            className={inputClass}
          >
            <option value="TESTNET">Testnet</option>
            <option value="PUBLIC">Public (Mainnet)</option>
          </select>
        </div>

        <div className="mt-6 grid grid-cols-2 gap-4">
          <div className="flex flex-col gap-2">
            <label className="text-sm font-medium text-ink">Asset code (blank = XLM)</label>
            <input
              value={assetCode}
              onChange={(e) => setAssetCode(e.target.value.toUpperCase())}
              placeholder="USDC"
              className={inputClass}
            />
          </div>
          <div className="flex flex-col gap-2">
            <label className="text-sm font-medium text-ink">Asset issuer</label>
            <input
              value={assetIssuer}
              onChange={(e) => setAssetIssuer(e.target.value)}
              placeholder="G..."
              className={inputClass}
            />
          </div>
        </div>

        <button
          onClick={handleSubmit}
          disabled={submitting}
          className="mt-6 w-full rounded-md bg-accent px-6 py-3 text-sm font-medium text-accent-ink hover:bg-accent-hover disabled:opacity-50"
        >
          {submitting ? "Uploading…" : "Upload & validate"}
        </button>
      </div>
    </div>
  );
}
