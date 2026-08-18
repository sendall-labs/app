"use client";

import { useCallback, useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { useWallet } from "@/components/wallet/WalletProvider";

function countCsvRows(text: string): number {
  const lines = text.split(/\r?\n/).filter((line) => line.trim().length > 0);
  return Math.max(0, lines.length - 1); // minus header row
}

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
    <div className="mx-auto flex w-full max-w-xl flex-col gap-6 px-6 py-12">
      <h1 className="text-2xl font-bold">New batch</h1>

      <div className="flex flex-col gap-2">
        <label className="text-sm font-medium">Recipients CSV</label>
        <input
          type="file"
          accept=".csv,text/csv"
          onChange={(e) => handleFileChange(e.target.files?.[0] ?? null)}
          className="rounded-md border border-neutral-300 p-2 text-sm dark:border-neutral-700"
        />
        <p className="text-xs text-neutral-500">
          Columns: <code>destination</code>, <code>amount</code>, optional <code>memo</code>.
        </p>
        {rowCount !== null && (
          <p className="text-xs text-neutral-600 dark:text-neutral-300">
            {rowCount} recipient row{rowCount === 1 ? "" : "s"} detected.
          </p>
        )}
      </div>

      <div className="flex flex-col gap-2">
        <label className="text-sm font-medium">Network</label>
        <select
          value={network}
          onChange={(e) => setNetwork(e.target.value as typeof network)}
          className="rounded-md border border-neutral-300 bg-transparent p-2 text-sm dark:border-neutral-700"
        >
          <option value="TESTNET">Testnet</option>
          <option value="PUBLIC">Public (Mainnet)</option>
        </select>
      </div>

      <div className="grid grid-cols-2 gap-4">
        <div className="flex flex-col gap-2">
          <label className="text-sm font-medium">Asset code (blank = XLM)</label>
          <input
            value={assetCode}
            onChange={(e) => setAssetCode(e.target.value.toUpperCase())}
            placeholder="USDC"
            className="rounded-md border border-neutral-300 p-2 text-sm dark:border-neutral-700"
          />
        </div>
        <div className="flex flex-col gap-2">
          <label className="text-sm font-medium">Asset issuer</label>
          <input
            value={assetIssuer}
            onChange={(e) => setAssetIssuer(e.target.value)}
            placeholder="G..."
            className="rounded-md border border-neutral-300 p-2 text-sm dark:border-neutral-700"
          />
        </div>
      </div>

      <button
        onClick={handleSubmit}
        disabled={submitting}
        className="rounded-md bg-neutral-900 px-6 py-3 text-sm font-medium text-white hover:bg-neutral-700 disabled:opacity-50 dark:bg-white dark:text-neutral-900"
      >
        {submitting ? "Uploading…" : "Upload & validate"}
      </button>
    </div>
  );
}
