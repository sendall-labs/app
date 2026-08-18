"use client";

import { useCallback, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { useWallet } from "@/components/wallet/WalletProvider";

const CSV_HEADER = "destination,amount,memo";
const EXAMPLE_ROWS = [
  "GDM5TPUTB7A7UW4QJ5SGUVA7WVJCNOHZO5RZIYM2Y4B3MJQB3F6CGOC5,10",
  "GBRPYHIL2CI3FNQ4BXLFMNDLFJUNPU2HY3ZMFSHONUCEOASW7QC7OX2H,5.5,thanks",
].join("\n");

function nonEmptyLineCount(text: string): number {
  return text.split(/\r?\n/).filter((line) => line.trim().length > 0).length;
}

/** Strips a leading destination/amount header row, if the uploaded file has one. */
function stripHeaderIfPresent(text: string): string {
  const lines = text.split(/\r?\n/);
  if (lines[0]?.trim().toLowerCase().replace(/\s/g, "") === CSV_HEADER) {
    return lines.slice(1).join("\n");
  }
  return text;
}

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

  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const gutterRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const lineCount = Math.max(1, nonEmptyLineCount(rows) || rows.split(/\r?\n/).length);
  const lineNumbers = useMemo(
    () => Array.from({ length: lineCount }, (_, i) => i + 1).join("\n"),
    [lineCount]
  );

  const syncGutterScroll = useCallback(() => {
    if (gutterRef.current && textareaRef.current) {
      gutterRef.current.scrollTop = textareaRef.current.scrollTop;
    }
  }, []);

  const handleFilePicked = useCallback(async (file: File) => {
    const text = await file.text();
    setRows(stripHeaderIfPresent(text.trim()));
    setFileName(file.name);
  }, []);

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
      <div>
        <h1 className="font-serif text-2xl font-semibold text-ink">New batch</h1>
        <p className="mt-1 text-sm text-ink-muted">
          Paste or type recipients, or upload a CSV — then pick a network and asset before
          review.
        </p>
      </div>

      <div className="rounded-lg border border-hairline bg-surface p-6">
        <div className="flex flex-col gap-2">
          <div className="flex items-center justify-between">
            <label className="text-sm font-medium text-ink">Addresses with amounts</label>
            <div className="flex items-center gap-4 text-xs">
              <button
                type="button"
                onClick={() => {
                  setRows(EXAMPLE_ROWS);
                  setFileName(null);
                }}
                className="text-accent hover:underline"
              >
                Show example
              </button>
              <button
                type="button"
                onClick={() => fileInputRef.current?.click()}
                className="text-accent hover:underline"
              >
                Upload CSV
              </button>
              <input
                ref={fileInputRef}
                type="file"
                accept=".csv,text/csv"
                className="hidden"
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  if (file) handleFilePicked(file);
                  e.target.value = "";
                }}
              />
            </div>
          </div>

          <div className="flex overflow-hidden rounded-md border border-hairline bg-paper focus-within:border-accent">
            <div
              ref={gutterRef}
              aria-hidden
              className="select-none overflow-hidden whitespace-pre px-3 py-2 text-right font-mono text-sm text-ink-faint"
            >
              {lineNumbers}
            </div>
            <textarea
              ref={textareaRef}
              value={rows}
              onChange={(e) => {
                setRows(e.target.value);
                setFileName(null);
              }}
              onScroll={syncGutterScroll}
              spellCheck={false}
              rows={8}
              placeholder={"GDM5TP...CGOC5,10\nGBRPYH...7OX2H,5.5,optional memo"}
              className="min-w-0 flex-1 resize-y bg-transparent px-3 py-2 font-mono text-sm text-ink placeholder:text-ink-faint focus:outline-none"
            />
          </div>
          <p className="text-xs text-ink-faint">
            One recipient per line: <code>address,amount</code>, optional third column for a
            memo.
          </p>
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
