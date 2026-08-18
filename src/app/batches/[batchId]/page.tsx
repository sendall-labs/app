"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useParams } from "next/navigation";
import { toast } from "sonner";
import { useWallet } from "@/components/wallet/WalletProvider";
import { CSV_HEADER } from "@/components/batches/RecipientsEditor";

type Recipient = {
  id: string;
  rowIndex: number;
  destination: string;
  amount: string;
  memo: string | null;
  addressValid: boolean;
  isDuplicate: boolean;
  accountExists: boolean | null;
  currentBalance: string | null;
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
  csvFileName: string | null;
  recipients: Recipient[];
  attempts: Attempt[];
};

type EditableRow = {
  id: string;
  destination: string;
  amount: string;
  memo: string | null;
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

const STATUS_PILL: Record<string, string> = {
  READY: "bg-success-soft text-success",
  SUCCESS: "bg-success-soft text-success",
  FAILED: "bg-danger-soft text-danger",
  CHECK_FAILED: "bg-danger-soft text-danger",
  VALIDATION_FAILED: "bg-danger-soft text-danger",
};

const RECHECKABLE_STATUSES = new Set(["PENDING", "READY", "CHECK_FAILED"]);
const BUSY_BATCH_STATUSES = new Set(["CHECKING", "SUBMITTING"]);

type Stage = "prepare" | "confirm" | "send";
const STAGES: { key: Stage; label: string }[] = [
  { key: "prepare", label: "Prepare" },
  { key: "confirm", label: "Confirm" },
  { key: "send", label: "Send" },
];

function stageFromStatus(status: string): Stage {
  if (status === "SUBMITTING" || status === "PARTIAL_FAILURE" || status === "COMPLETED") return "send";
  if (status === "READY") return "confirm";
  return "prepare";
}

function statusPillClass(status: string): string {
  return STATUS_PILL[status] ?? "bg-warning-soft text-warning";
}

function explorerTxUrl(network: string, txHash: string): string {
  const segment = network === "PUBLIC" ? "public" : "testnet";
  return `https://stellar.expert/explorer/${segment}/tx/${txHash}`;
}

function truncateAddress(address: string): string {
  if (address.length <= 14) return address;
  return `${address.slice(0, 6)}…${address.slice(-6)}`;
}

function recipientToRow(r: Recipient): EditableRow {
  return { id: r.id, destination: r.destination, amount: r.amount, memo: r.memo };
}

function RefreshIcon({ spinning }: { spinning?: boolean }) {
  return (
    <svg
      viewBox="0 0 20 20"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      className={`h-4 w-4 ${spinning ? "motion-safe:animate-spin" : ""}`}
    >
      <path d="M15.5 4.5A7 7 0 1 0 17 10" strokeLinecap="round" />
      <path d="M17 4v4h-4" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

export default function BatchReviewPage() {
  const { batchId } = useParams<{ batchId: string }>();
  const { signTransaction } = useWallet();
  const [batch, setBatch] = useState<Batch | null>(null);
  const [bulkBusy, setBulkBusy] = useState<string | null>(null);
  const [busyRowIds, setBusyRowIds] = useState<Set<string>>(new Set());
  // null = mirror the server copy (recomputed below); non-null = unsaved
  // local edits. Kept this way (instead of syncing via an effect) so a
  // background poll updating `batch` never clobbers in-progress edits.
  const [editedRows, setEditedRows] = useState<EditableRow[] | null>(null);
  const [saving, setSaving] = useState(false);
  const dirty = editedRows !== null;

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

  const canEdit = batch ? batch.attempts.length === 0 : false;
  const anyBusy = bulkBusy !== null || busyRowIds.size > 0;
  const rows: EditableRow[] = useMemo(
    () => editedRows ?? (batch ? batch.recipients.map(recipientToRow) : []),
    [editedRows, batch]
  );

  const updateRow = useCallback(
    (id: string, field: "destination" | "amount", value: string) => {
      setEditedRows((prev) => (prev ?? rows).map((r) => (r.id === id ? { ...r, [field]: value } : r)));
    },
    [rows]
  );

  const removeRow = useCallback(
    (id: string) => {
      setEditedRows((prev) => (prev ?? rows).filter((r) => r.id !== id));
    },
    [rows]
  );

  const addRow = useCallback(() => {
    setEditedRows((prev) => {
      const base = prev ?? rows;
      return [...base, { id: `new-${Date.now()}-${base.length}`, destination: "", amount: "", memo: null }];
    });
  }, [rows]);

  const discardEdits = useCallback(() => {
    setEditedRows(null);
  }, []);

  const saveEdits = useCallback(async () => {
    const nonEmpty = rows.filter((r) => r.destination.trim() || r.amount.trim());
    if (nonEmpty.length === 0) {
      toast.error("Add at least one address and amount");
      return;
    }
    const csvText = `${CSV_HEADER}\n${nonEmpty
      .map((r) => [r.destination.trim(), r.amount.trim(), r.memo].filter((v) => v != null && v !== "").join(","))
      .join("\n")}`;

    setSaving(true);
    try {
      const res = await fetch(`/api/batches/${batchId}/recipients`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ csvText }),
      });
      if (!res.ok) throw new Error((await res.json()).error ?? "Failed to save recipients");
      const { batch: updated, parseErrors } = await res.json();
      setBatch(updated);
      setEditedRows(null);
      if (parseErrors?.length) {
        toast.warning(`${parseErrors.length} row(s) skipped — missing address/amount`);
      }
      toast.success("Recipients updated");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to save recipients");
    } finally {
      setSaving(false);
    }
  }, [batchId, rows]);

  const runChecks = useCallback(
    async (recipientIds: string[] | undefined, mode: "row" | "bulk") => {
      if (mode === "row" && recipientIds) {
        setBusyRowIds((prev) => new Set([...prev, ...recipientIds]));
      } else {
        setBulkBusy(recipientIds ? "refresh-all" : "checks");
      }
      try {
        const res = await fetch(`/api/batches/${batchId}/checks`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(recipientIds ? { recipientIds } : {}),
        });
        if (!res.ok) throw new Error((await res.json()).error ?? "Check failed");
        await load();
        if (mode === "bulk") toast.success("Balance/trustline checks complete");
      } catch (err) {
        toast.error(err instanceof Error ? err.message : "Check failed");
      } finally {
        if (mode === "row" && recipientIds) {
          setBusyRowIds((prev) => {
            const next = new Set(prev);
            recipientIds.forEach((id) => next.delete(id));
            return next;
          });
        } else {
          setBulkBusy(null);
        }
      }
    },
    [batchId, load]
  );

  const refreshOne = useCallback((id: string) => runChecks([id], "row"), [runChecks]);

  const refreshAll = useCallback(() => {
    if (!batch) return;
    const ids = batch.recipients
      .filter((r) => r.addressValid && !r.isDuplicate && RECHECKABLE_STATUSES.has(r.status))
      .map((r) => r.id);
    if (ids.length === 0) return;
    return runChecks(ids, "bulk");
  }, [batch, runChecks]);

  const prepareAndSend = useCallback(async () => {
    setBulkBusy("send");
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
      setBulkBusy(null);
    }
  }, [batchId, load, signTransaction]);

  const retryFailed = useCallback(async () => {
    setBulkBusy("retry");
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
      setBulkBusy(null);
    }
  }, [batchId, load, signTransaction]);

  const refreshableCount = useMemo(() => {
    if (!batch) return 0;
    return batch.recipients.filter(
      (r) => r.addressValid && !r.isDuplicate && RECHECKABLE_STATUSES.has(r.status)
    ).length;
  }, [batch]);

  if (!batch) return <p className="text-sm text-ink-muted">Loading…</p>;

  const readyCount = batch.recipients.filter((r) => r.status === "READY").length;
  const failedCount = batch.recipients.filter((r) => r.status === "FAILED").length;
  const pendingCount = batch.recipients.filter((r) => r.status === "PENDING").length;
  const currentStage = stageFromStatus(batch.status);

  const txHashByRecipient = new Map<string, string>();
  for (const attempt of batch.attempts) {
    if (!attempt.txHash) continue;
    for (const item of attempt.items) {
      if (item.status === "SUCCESS") txHashByRecipient.set(item.recipientId, attempt.txHash);
    }
  }
  const recipientById = new Map(batch.recipients.map((r) => [r.id, r]));

  return (
    <div className="flex flex-col gap-6">
      <nav className="flex gap-1 border-b border-hairline">
        {STAGES.map((stage, i) => {
          const stageIndex = STAGES.findIndex((s) => s.key === currentStage);
          const isCurrent = stage.key === currentStage;
          const isDone = i < stageIndex;
          return (
            <div
              key={stage.key}
              className={`flex items-center gap-2 border-b-2 px-1 pb-3 text-sm font-medium ${
                isCurrent
                  ? "border-accent text-ink"
                  : isDone
                    ? "border-transparent text-ink-muted"
                    : "border-transparent text-ink-faint"
              }`}
            >
              <span
                className={`flex h-5 w-5 items-center justify-center rounded-full text-[11px] ${
                  isCurrent
                    ? "bg-accent text-accent-ink"
                    : isDone
                      ? "bg-success-soft text-success"
                      : "bg-sidebar text-ink-faint"
                }`}
              >
                {isDone ? "✓" : i + 1}
              </span>
              {stage.label}
            </div>
          );
        })}
      </nav>

      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="font-serif text-2xl font-semibold text-ink">Batch review</h1>
          <p className="mt-1 text-sm text-ink-muted">{batch.csvFileName ?? batch.id}</p>
        </div>
        <div className="flex flex-wrap gap-2">
          {dirty ? (
            <>
              <button
                onClick={saveEdits}
                disabled={saving}
                className="rounded-md bg-accent px-4 py-2 text-sm font-medium text-accent-ink hover:bg-accent-hover disabled:opacity-50"
              >
                {saving ? "Saving…" : "Save changes"}
              </button>
              <button
                onClick={discardEdits}
                disabled={saving}
                className="rounded-md border border-hairline px-4 py-2 text-sm font-medium text-ink hover:bg-sidebar disabled:opacity-50"
              >
                Discard
              </button>
            </>
          ) : (
            <>
              {refreshableCount > 0 && (
                <button
                  onClick={refreshAll}
                  disabled={anyBusy}
                  className="rounded-md border border-hairline px-4 py-2 text-sm font-medium text-ink hover:bg-sidebar disabled:opacity-50"
                >
                  {bulkBusy === "refresh-all" ? "Refreshing…" : `Refresh all (${refreshableCount})`}
                </button>
              )}
              {pendingCount > 0 && (
                <button
                  onClick={() => runChecks(undefined, "bulk")}
                  disabled={anyBusy}
                  className="rounded-md border border-hairline px-4 py-2 text-sm font-medium text-ink hover:bg-sidebar disabled:opacity-50"
                >
                  {bulkBusy === "checks" ? "Checking…" : "Run checks"}
                </button>
              )}
              {readyCount > 0 && (
                <button
                  onClick={prepareAndSend}
                  disabled={anyBusy}
                  className="rounded-md bg-accent px-4 py-2 text-sm font-medium text-accent-ink hover:bg-accent-hover disabled:opacity-50"
                >
                  {bulkBusy === "send" ? "Sending…" : `Sign & send (${readyCount})`}
                </button>
              )}
              {failedCount > 0 && (
                <button
                  onClick={retryFailed}
                  disabled={anyBusy}
                  className="rounded-md border border-danger/30 px-4 py-2 text-sm font-medium text-danger hover:bg-danger-soft disabled:opacity-50"
                >
                  {bulkBusy === "retry" ? "Retrying…" : `Retry failed (${failedCount})`}
                </button>
              )}
            </>
          )}
        </div>
      </div>

      <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
        <InfoField label="Network" value={batch.network} />
        <InfoField label="Asset" value={batch.assetCode ?? "XLM"} />
        <InfoField label="Recipients" value={String(batch.recipients.length)} />
        <InfoField
          label="Status"
          value={
            <span className={`rounded-full px-2.5 py-1 text-xs font-medium ${statusPillClass(batch.status)}`}>
              {batch.status}
            </span>
          }
        />
      </div>

      <div className="rounded-lg border border-hairline bg-surface">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-hairline text-left text-xs uppercase tracking-wide text-ink-faint">
                <th className="px-5 py-3 font-medium">#</th>
                <th className="px-5 py-3 font-medium">Address</th>
                <th className="px-5 py-3 font-medium">Amount</th>
                <th className="px-5 py-3 font-medium">Account created</th>
                <th className="px-5 py-3 font-medium">Current balance</th>
                <th className="px-5 py-3 font-medium">Status</th>
                <th className="px-5 py-3 font-medium">Note</th>
                <th className="px-5 py-3 font-medium" />
              </tr>
            </thead>
            <tbody>
              {rows.map((row, i) => {
                const r = recipientById.get(row.id);
                const isNew = !r;
                return (
                  <tr key={row.id} className="border-b border-hairline last:border-0">
                    <td className="px-5 py-3 tabular-nums text-ink-muted">{r?.rowIndex ?? i + 1}</td>
                    <td className="px-5 py-3">
                      {canEdit ? (
                        <input
                          value={row.destination}
                          onChange={(e) => updateRow(row.id, "destination", e.target.value)}
                          placeholder="G..."
                          className="w-full min-w-[220px] rounded border border-transparent bg-transparent px-2 py-1 font-mono text-xs text-ink hover:border-hairline focus:border-accent focus:outline-none"
                        />
                      ) : (
                        <span className="font-mono text-xs text-ink">{truncateAddress(row.destination)}</span>
                      )}
                      {r?.isDuplicate && (
                        <span className="ml-2 rounded-full bg-warning-soft px-2 py-0.5 text-[10px] font-medium text-warning">
                          dup
                        </span>
                      )}
                    </td>
                    <td className="px-5 py-3">
                      {canEdit ? (
                        <input
                          value={row.amount}
                          onChange={(e) => updateRow(row.id, "amount", e.target.value)}
                          placeholder="0"
                          inputMode="decimal"
                          className="w-24 rounded border border-transparent bg-transparent px-2 py-1 tabular-nums text-ink hover:border-hairline focus:border-accent focus:outline-none"
                        />
                      ) : (
                        <span className="tabular-nums text-ink">{row.amount}</span>
                      )}
                    </td>
                    <td className="px-5 py-3 text-ink-muted">
                      {isNew ? "—" : r.accountExists === null ? "—" : r.accountExists ? "Yes" : "No"}
                    </td>
                    <td className="px-5 py-3 tabular-nums text-ink-muted">
                      {isNew ? "—" : (r.currentBalance ?? "—")}
                    </td>
                    <td className="px-5 py-3">
                      {isNew ? (
                        <span className="rounded-full bg-sidebar px-2.5 py-1 text-xs font-medium text-ink-muted">
                          New
                        </span>
                      ) : (
                        <span className={`rounded-full px-2.5 py-1 text-xs font-medium ${statusPillClass(r.status)}`}>
                          {STATUS_LABEL[r.status] ?? r.status}
                        </span>
                      )}
                    </td>
                    <td className="px-5 py-3 text-ink-muted">
                      {r?.errorMessage}
                      {r && txHashByRecipient.has(r.id) && (
                        <a
                          href={explorerTxUrl(batch.network, txHashByRecipient.get(r.id)!)}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="font-mono text-xs text-accent hover:underline"
                        >
                          view tx ↗
                        </a>
                      )}
                    </td>
                    <td className="px-5 py-3">
                      <div className="flex items-center justify-end gap-1.5">
                        {r && r.addressValid && !r.isDuplicate && RECHECKABLE_STATUSES.has(r.status) && (
                          <button
                            onClick={() => refreshOne(r.id)}
                            disabled={busyRowIds.has(r.id) || bulkBusy !== null || dirty}
                            title="Refresh this address"
                            className="inline-flex h-8 w-8 items-center justify-center rounded-md border border-hairline text-ink-muted hover:bg-sidebar hover:text-ink disabled:opacity-40"
                          >
                            <RefreshIcon spinning={busyRowIds.has(r.id)} />
                          </button>
                        )}
                        {canEdit && (
                          <button
                            onClick={() => removeRow(row.id)}
                            title="Remove recipient"
                            className="inline-flex h-8 w-8 items-center justify-center rounded-md border border-hairline text-ink-muted hover:border-danger/30 hover:bg-danger-soft hover:text-danger"
                          >
                            ×
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        {canEdit && (
          <button
            onClick={addRow}
            className="w-full border-t border-dashed border-hairline px-5 py-3 text-left text-sm font-medium text-accent hover:bg-sidebar"
          >
            + Add recipient
          </button>
        )}
      </div>
    </div>
  );
}

function InfoField({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="rounded-lg border border-hairline bg-surface px-5 py-4">
      <p className="text-xs uppercase tracking-wide text-ink-faint">{label}</p>
      <div className="mt-1.5 text-sm font-medium text-ink">{value}</div>
    </div>
  );
}
