"use client";

import { useCallback, useEffect, useState } from "react";
import { useParams } from "next/navigation";
import { toast } from "sonner";
import { useWallet } from "@/components/wallet/WalletProvider";

type Recipient = {
  id: string;
  rowIndex: number;
  destination: string;
  amount: string;
  addressValid: boolean;
  isDuplicate: boolean;
  accountExists: boolean | null;
  hasTrustline: boolean | null;
  status: string;
  errorMessage: string | null;
};

type AttemptItem = { recipientId: string; status: string };
type Attempt = { txHash: string | null; items: AttemptItem[] };

type Batch = {
  id: string;
  status: string;
  network: string;
  assetCode: string | null;
  assetIssuer: string | null;
  sourceAccount: string;
  recipients: Recipient[];
  attempts: Attempt[];
};

const STATUS_LABEL: Record<string, string> = {
  PENDING: "Pending",
  VALIDATION_FAILED: "Invalid",
  CHECK_FAILED: "Check failed",
  READY: "Ready",
  IN_TRANSACTION: "Submitting",
  SUCCESS: "Sent",
  FAILED: "Failed",
};

const BUSY_BATCH_STATUSES = new Set(["CHECKING", "SUBMITTING"]);

function explorerTxUrl(network: string, txHash: string): string {
  const segment = network === "PUBLIC" ? "public" : "testnet";
  return `https://stellar.expert/explorer/${segment}/tx/${txHash}`;
}

export default function BatchReviewPage() {
  const { batchId } = useParams<{ batchId: string }>();
  const { signTransaction } = useWallet();
  const [batch, setBatch] = useState<Batch | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const load = useCallback(async () => {
    const res = await fetch(`/api/batches/${batchId}`);
    if (!res.ok) return;
    const { batch } = await res.json();
    setBatch(batch);
  }, [batchId]);

  useEffect(() => {
    let cancelled = false;
    fetch(`/api/batches/${batchId}`)
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => {
        if (!cancelled && data) setBatch(data.batch);
      });
    return () => {
      cancelled = true;
    };
  }, [batchId]);

  // Poll while the batch is mid-flight (checks running or a submit in
  // progress from another tab) so the status/table reflect the outcome
  // without the user having to refresh manually.
  useEffect(() => {
    if (!batch || !BUSY_BATCH_STATUSES.has(batch.status)) return;
    const interval = setInterval(load, 2500);
    return () => clearInterval(interval);
  }, [batch, load]);

  const runChecks = useCallback(async () => {
    setBusy("checks");
    try {
      const res = await fetch(`/api/batches/${batchId}/checks`, { method: "POST" });
      if (!res.ok) throw new Error((await res.json()).error ?? "Check failed");
      await load();
      toast.success("Balance/trustline checks complete");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Check failed");
    } finally {
      setBusy(null);
    }
  }, [batchId, load]);

  const prepareAndSend = useCallback(async () => {
    setBusy("send");
    try {
      const prepareRes = await fetch(`/api/batches/${batchId}/prepare`, { method: "POST" });
      if (!prepareRes.ok) throw new Error((await prepareRes.json()).error ?? "Prepare failed");
      const { attempts } = await prepareRes.json();

      for (const attempt of attempts) {
        const signedXdr = await signTransaction(attempt.xdr);
        const submitRes = await fetch(`/api/batches/${batchId}/submit`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ attemptId: attempt.attemptId, signedXdr }),
        });
        if (!submitRes.ok) throw new Error((await submitRes.json()).error ?? "Submit failed");
      }

      await load();
      toast.success("Batch submitted");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Send failed");
    } finally {
      setBusy(null);
    }
  }, [batchId, load, signTransaction]);

  const retryFailed = useCallback(async () => {
    setBusy("retry");
    try {
      const retryRes = await fetch(`/api/batches/${batchId}/retry`, { method: "POST" });
      if (!retryRes.ok) throw new Error((await retryRes.json()).error ?? "Retry failed");
      const { attempts } = await retryRes.json();

      for (const attempt of attempts) {
        const signedXdr = await signTransaction(attempt.xdr);
        const submitRes = await fetch(`/api/batches/${batchId}/submit`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ attemptId: attempt.attemptId, signedXdr }),
        });
        if (!submitRes.ok) throw new Error((await submitRes.json()).error ?? "Submit failed");
      }

      await load();
      toast.success("Retry complete");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Retry failed");
    } finally {
      setBusy(null);
    }
  }, [batchId, load, signTransaction]);

  if (!batch) return <div className="px-6 py-12">Loading…</div>;

  const readyCount = batch.recipients.filter((r) => r.status === "READY").length;
  const failedCount = batch.recipients.filter((r) => r.status === "FAILED").length;
  const pendingCount = batch.recipients.filter((r) => r.status === "PENDING").length;

  const txHashByRecipient = new Map<string, string>();
  for (const attempt of batch.attempts) {
    if (!attempt.txHash) continue;
    for (const item of attempt.items) {
      if (item.status === "SUCCESS") txHashByRecipient.set(item.recipientId, attempt.txHash);
    }
  }

  return (
    <div className="mx-auto flex w-full max-w-4xl flex-col gap-6 px-6 py-12">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">Batch review</h1>
          <p className="text-sm text-neutral-500">
            {batch.network} · {batch.assetCode ?? "XLM"} · status: {batch.status}
          </p>
        </div>
        <div className="flex gap-2">
          {pendingCount > 0 && (
            <button
              onClick={runChecks}
              disabled={busy !== null}
              className="rounded-md border border-neutral-300 px-4 py-2 text-sm font-medium hover:bg-neutral-100 disabled:opacity-50 dark:border-neutral-700 dark:hover:bg-neutral-800"
            >
              {busy === "checks" ? "Checking…" : "Run checks"}
            </button>
          )}
          {readyCount > 0 && (
            <button
              onClick={prepareAndSend}
              disabled={busy !== null}
              className="rounded-md bg-neutral-900 px-4 py-2 text-sm font-medium text-white hover:bg-neutral-700 disabled:opacity-50 dark:bg-white dark:text-neutral-900"
            >
              {busy === "send" ? "Sending…" : `Sign & send (${readyCount})`}
            </button>
          )}
          {failedCount > 0 && (
            <button
              onClick={retryFailed}
              disabled={busy !== null}
              className="rounded-md border border-red-300 px-4 py-2 text-sm font-medium text-red-700 hover:bg-red-50 disabled:opacity-50"
            >
              {busy === "retry" ? "Retrying…" : `Retry failed (${failedCount})`}
            </button>
          )}
        </div>
      </div>

      <div className="overflow-x-auto rounded-md border border-neutral-200 dark:border-neutral-800">
        <table className="w-full text-sm">
          <thead className="bg-neutral-50 text-left dark:bg-neutral-900">
            <tr>
              <th className="px-3 py-2">#</th>
              <th className="px-3 py-2">Destination</th>
              <th className="px-3 py-2">Amount</th>
              <th className="px-3 py-2">Status</th>
              <th className="px-3 py-2">Note</th>
            </tr>
          </thead>
          <tbody>
            {batch.recipients.map((r) => (
              <tr key={r.id} className="border-t border-neutral-100 dark:border-neutral-800">
                <td className="px-3 py-2">{r.rowIndex}</td>
                <td className="px-3 py-2 font-mono text-xs">
                  {r.destination.slice(0, 6)}…{r.destination.slice(-6)}
                  {r.isDuplicate && <span className="ml-2 text-amber-600">dup</span>}
                </td>
                <td className="px-3 py-2">{r.amount}</td>
                <td className="px-3 py-2">{STATUS_LABEL[r.status] ?? r.status}</td>
                <td className="px-3 py-2 text-neutral-500">
                  {r.errorMessage}
                  {txHashByRecipient.has(r.id) && (
                    <a
                      href={explorerTxUrl(batch.network, txHashByRecipient.get(r.id)!)}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="font-mono text-xs text-blue-600 hover:underline dark:text-blue-400"
                    >
                      view tx ↗
                    </a>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
