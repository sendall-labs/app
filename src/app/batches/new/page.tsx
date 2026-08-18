"use client";

import { useCallback, useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { useWallet } from "@/components/wallet/WalletProvider";
import { RecipientsEditor, CSV_HEADER } from "@/components/batches/RecipientsEditor";
import { BatchStageNav } from "@/components/batches/BatchStageNav";

const inputClass =
  "rounded-md border border-hairline bg-paper px-3 py-2 text-sm text-ink placeholder:text-ink-faint focus:border-accent focus:outline-none";

export default function NewBatchPage() {
  const router = useRouter();
  const { network, setNetwork, address } = useWallet();
  const [rows, setRows] = useState("");
  const [fileName, setFileName] = useState<string | null>(null);
  const [assetCode, setAssetCode] = useState("");
  const [assetIssuer, setAssetIssuer] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const handleSubmit = useCallback(async () => {
    if (!address) {
      toast.error("Connect and sign in with your wallet first");
      return;
    }
    if (!rows.trim()) {
      toast.error("Add at least one address and amount");
      return;
    }

    setSubmitting(true);
    try {
      const csvText = `${CSV_HEADER}\n${rows.trim()}`;
      const res = await fetch("/api/batches", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          csvText,
          csvFileName: fileName ?? undefined,
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
        toast.warning(`${parseErrors.length} row(s) skipped — missing address/amount`);
      }
      router.push(`/batches/${batch.id}`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to create batch");
    } finally {
      setSubmitting(false);
    }
  }, [address, assetCode, assetIssuer, fileName, rows, network, router]);

  return (
    <div className="flex max-w-2xl flex-col gap-6">
      <BatchStageNav current="prepare" />

      <div>
        <h1 className="font-serif text-2xl font-semibold text-ink">New batch</h1>
        <p className="mt-1 text-sm text-ink-muted">
          Paste or type recipients, or upload a CSV — then pick a network and asset before
          review.
        </p>
      </div>

      <div className="rounded-lg border border-hairline bg-surface p-6">
        <RecipientsEditor value={rows} onChange={setRows} onFileNameChange={setFileName} />

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
