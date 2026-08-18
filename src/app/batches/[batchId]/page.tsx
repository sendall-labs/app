"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useParams } from "next/navigation";
import { toast } from "sonner";
import { useWallet } from "@/components/wallet/WalletProvider";
import { RecipientsEditor } from "@/components/batches/RecipientsEditor";
import { BatchStageNav, stageFromStatus, type Stage } from "@/components/batches/BatchStageNav";

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
const SAVE_DEBOUNCE_MS = 700;

function statusPillClass(status: string): string {
  return STATUS_PILL[status] ?? "bg-warning-soft text-warning";
}

function explorerTxUrl(network: string, txHash: string): string {
  const segment = network === "PUBLIC" ? "public" : "testnet";
  return `https://stellar.expert/explorer/${segment}/tx/${txHash}`;
}

function explorerAccountUrl(network: string, address: string): string {
  const segment = network === "PUBLIC" ? "public" : "testnet";
  return `https://stellar.expert/explorer/${segment}/account/${address}`;
}

function recipientToRow(r: Recipient): EditableRow {
  return { id: r.id, destination: r.destination, amount: r.amount, memo: r.memo };
}

function rowToLine(r: EditableRow): string {
  if (!r.destination && !r.amount && !r.memo) return "";
  const parts = [r.destination, r.amount];
  if (r.memo) parts.push(r.memo);
  return parts.join(",");
}

function rowsToText(rows: EditableRow[]): string {
  return rows.map(rowToLine).join("\n");
}

/** Parses "destination,amount,memo" lines back into rows, preserving each
 * existing row's id by position so unedited/edited-in-place rows don't get
 * needlessly deleted and recreated server-side. */
function textToRows(text: string, prevRows: EditableRow[]): EditableRow[] {
  return text.split(/\r?\n/).map((line, i) => {
    const [rawDestination = "", rawAmount = "", ...rest] = line.split(",");
    return {
      id: prevRows[i]?.id ?? `new-${Date.now()}-${i}`,
      destination: rawDestination.trim(),
      amount: rawAmount.trim(),
      memo: rest.length > 0 ? rest.join(",").trim() || null : null,
    };
  });
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

function CopyIcon() {
  return (
    <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.6" className="h-4 w-4">
      <rect x="7" y="7" width="10" height="10" rx="1.5" />
      <path d="M4.5 13V4.5A1.5 1.5 0 0 1 6 3h8.5" strokeLinecap="round" />
    </svg>
  );
}

function ExternalLinkIcon() {
  return (
    <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.6" className="h-4 w-4">
      <path d="M8.5 4.5H4.5v11h11v-4" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M9.5 10.5 15.5 4.5M11 4.5h4.5V9" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

export default function BatchReviewPage() {
  const { batchId } = useParams<{ batchId: string }>();
  const { signTransaction } = useWallet();
  const [batch, setBatch] = useState<Batch | null>(null);
  const [bulkBusy, setBulkBusy] = useState<string | null>(null);
  const [busyRowIds, setBusyRowIds] = useState<Set<string>>(new Set());
  // null = mirror the server copy (recomputed below); non-null = the exact
  // raw text the user is typing. Kept as raw text (instead of round-tripping
  // through parsed rows on every keystroke) so the textarea never
  // reformats — and inserts characters like a trailing "," — out from under
  // the user's cursor.
  const [prepareText, setPrepareText] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [pinnedStage, setPinnedStage] = useState<Stage | null>(null);
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pendingRowsRef = useRef<EditableRow[]>([]);
  const autoCheckingRef = useRef(false);

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
        if (cancelled || !data) return;
        setBatch(data.batch);
        // Pin the view to wherever this batch actually stood on arrival —
        // otherwise the background auto-check (VALIDATED -> READY, see
        // below) flips the display to Confirm moments after the page
        // opens, even though the user never left Prepare.
        setPinnedStage(stageFromStatus(data.batch.status));
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
        if (mode === "bulk" && recipientIds) toast.success("Balance/trustline checks complete");
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

  // Whenever the batch lands in VALIDATED (just created, or just edited)
  // automatically re-validate addresses + account existence instead of
  // waiting for the user to press a button — covers both "Upload &
  // validate" on creation and any later inline edit.
  useEffect(() => {
    if (!batch || batch.status !== "VALIDATED" || autoCheckingRef.current) return;
    const checkableIds = batch.recipients
      .filter((r) => r.addressValid && !r.isDuplicate && r.status === "PENDING")
      .map((r) => r.id);
    if (checkableIds.length === 0) return;
    // Deferred a tick so this effect doesn't set state synchronously —
    // runChecks' first line flips bulkBusy immediately.
    const timer = setTimeout(() => {
      autoCheckingRef.current = true;
      runChecks(undefined, "bulk").finally(() => {
        autoCheckingRef.current = false;
      });
    }, 0);
    return () => clearTimeout(timer);
  }, [batch, runChecks]);

  // Guards against two overlapping PUTs racing the same batch's recipient
  // set (e.g. the debounce firing right as a blur-triggered flush also
  // fires) — the server transaction isn't safe against that, so a second
  // call while one's in flight is queued to run after, with whatever rows
  // are current at that time, instead of firing concurrently.
  const savingInFlightRef = useRef(false);
  const queuedRowsRef = useRef<EditableRow[] | null>(null);

  const persistRows = useCallback(
    async (rowsToSave: EditableRow[]) => {
      if (savingInFlightRef.current) {
        queuedRowsRef.current = rowsToSave;
        return;
      }
      savingInFlightRef.current = true;
      // Loop instead of recursing so a save queued while this one was in
      // flight runs right after, without ever overlapping with it.
      let current: EditableRow[] | null = rowsToSave;
      while (current) {
        const nonEmpty = current.filter((r) => r.destination.trim() || r.amount.trim());
        if (nonEmpty.length > 0) {
          setSaving(true);
          try {
            const res = await fetch(`/api/batches/${batchId}/recipients`, {
              method: "PUT",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                rows: nonEmpty.map((r) => ({
                  id: r.id.startsWith("new-") ? undefined : r.id,
                  destination: r.destination.trim(),
                  amount: r.amount.trim(),
                  memo: r.memo || undefined,
                })),
              }),
            });
            if (!res.ok) throw new Error((await res.json()).error ?? "Failed to save recipients");
            const { batch: updated } = await res.json();
            setBatch(updated);
          } catch (err) {
            toast.error(err instanceof Error ? err.message : "Failed to save recipients");
          } finally {
            setSaving(false);
          }
        }
        current = queuedRowsRef.current;
        queuedRowsRef.current = null;
      }
      savingInFlightRef.current = false;
    },
    [batchId]
  );

  const scheduleSave = useCallback(
    (next: EditableRow[]) => {
      pendingRowsRef.current = next;
      if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
      saveTimerRef.current = setTimeout(() => {
        saveTimerRef.current = null;
        persistRows(next);
      }, SAVE_DEBOUNCE_MS);
    },
    [persistRows]
  );

  const flushPendingSave = useCallback(() => {
    if (!saveTimerRef.current) return;
    clearTimeout(saveTimerRef.current);
    saveTimerRef.current = null;
    persistRows(pendingRowsRef.current);
  }, [persistRows]);

  const handlePrepareTextChange = useCallback(
    (text: string) => {
      setPrepareText(text);
      const next = textToRows(text, batch ? batch.recipients.map(recipientToRow) : []);
      scheduleSave(next);
    },
    [batch, scheduleSave]
  );

  const patchNetworkAsset = useCallback(
    async (next: { network: string; assetCode: string; assetIssuer: string }) => {
      setSaving(true);
      try {
        const res = await fetch(`/api/batches/${batchId}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            network: next.network,
            assetCode: next.assetCode || undefined,
            assetIssuer: next.assetIssuer || undefined,
          }),
        });
        if (!res.ok) throw new Error((await res.json()).error ?? "Failed to update network/asset");
        const { batch: updated } = await res.json();
        setBatch(updated);
      } catch (err) {
        toast.error(err instanceof Error ? err.message : "Failed to update network/asset");
      } finally {
        setSaving(false);
      }
    },
    [batchId]
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

  const copyAddress = useCallback((address: string) => {
    navigator.clipboard.writeText(address).then(
      () => toast.success("Address copied"),
      () => toast.error("Couldn't copy address")
    );
  }, []);

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
      setPinnedStage(null);
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
      setPinnedStage(null);
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
  const displayedStage = pinnedStage ?? stageFromStatus(batch.status);

  const txHashByRecipient = new Map<string, string>();
  for (const attempt of batch.attempts) {
    if (!attempt.txHash) continue;
    for (const item of attempt.items) {
      if (item.status === "SUCCESS") txHashByRecipient.set(item.recipientId, attempt.txHash);
    }
  }

  const savedRows = batch.recipients.map(recipientToRow);
  const prepareDisplayText = prepareText ?? rowsToText(savedRows);
  const draftRows = prepareText !== null ? textToRows(prepareText, savedRows) : savedRows;
  const recipientCount = draftRows.filter((r) => r.destination.trim() || r.amount.trim()).length;

  return (
    <div className="flex flex-col gap-6">
      <BatchStageNav current={displayedStage} onSelect={setPinnedStage} />

      <div>
        <h1 className="font-serif text-2xl font-semibold text-ink">Batch review</h1>
        <p className="mt-1 flex items-center gap-2 text-sm text-ink-muted">
          {batch.csvFileName ?? batch.id}
          {saving && <span className="text-xs text-ink-faint">Saving…</span>}
        </p>
      </div>

      <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
        {canEdit ? (
          <NetworkField
            network={batch.network}
            assetCode={batch.assetCode}
            assetIssuer={batch.assetIssuer}
            patchNetworkAsset={patchNetworkAsset}
          />
        ) : (
          <InfoField label="Network" value={batch.network} />
        )}
        {canEdit ? (
          <AssetField
            network={batch.network}
            assetCode={batch.assetCode}
            assetIssuer={batch.assetIssuer}
            patchNetworkAsset={patchNetworkAsset}
          />
        ) : (
          <InfoField label="Asset" value={batch.assetCode ?? "XLM"} />
        )}
        <InfoField label="Recipients" value={String(recipientCount)} />
        <InfoField
          label="Status"
          value={
            <span className={`rounded-full px-2.5 py-1 text-xs font-medium ${statusPillClass(batch.status)}`}>
              {batch.status}
            </span>
          }
        />
      </div>

      {displayedStage === "prepare" && (
        <PrepareSection
          text={prepareDisplayText}
          canEdit={canEdit}
          onTextChange={handlePrepareTextChange}
          flushPendingSave={flushPendingSave}
        />
      )}

      {displayedStage === "confirm" && (
        <div className="flex flex-col gap-4">
          <div className="flex flex-wrap justify-end gap-2">
            {refreshableCount > 0 && (
              <button
                onClick={refreshAll}
                disabled={anyBusy}
                className="rounded-md border border-hairline px-4 py-2 text-sm font-medium text-ink hover:bg-sidebar disabled:opacity-50"
              >
                {bulkBusy === "refresh-all" ? "Refreshing…" : `Refresh all (${refreshableCount})`}
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
          </div>
          <RecipientsTable
            recipients={batch.recipients}
            batch={batch}
            busyRowIds={busyRowIds}
            bulkBusy={bulkBusy}
            refreshOne={refreshOne}
            copyAddress={copyAddress}
            txHashByRecipient={txHashByRecipient}
          />
          {readyCount === 0 && (
            <p className="text-sm text-ink-muted">
              Nothing&apos;s ready to send yet — fix or refresh recipients on the Prepare tab first.
            </p>
          )}
        </div>
      )}

      {displayedStage === "send" && (
        <div className="flex flex-col gap-4">
          <div className="flex flex-wrap justify-end gap-2">
            {failedCount > 0 && (
              <button
                onClick={retryFailed}
                disabled={anyBusy}
                className="rounded-md border border-danger/30 px-4 py-2 text-sm font-medium text-danger hover:bg-danger-soft disabled:opacity-50"
              >
                {bulkBusy === "retry" ? "Retrying…" : `Retry failed (${failedCount})`}
              </button>
            )}
          </div>
          <RecipientsTable
            recipients={batch.recipients}
            batch={batch}
            busyRowIds={busyRowIds}
            bulkBusy={bulkBusy}
            refreshOne={refreshOne}
            copyAddress={copyAddress}
            txHashByRecipient={txHashByRecipient}
          />
          {batch.attempts.length === 0 && (
            <p className="text-sm text-ink-muted">
              Nothing&apos;s been sent yet — head to Confirm and sign to submit this batch.
            </p>
          )}
        </div>
      )}
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

const cardFieldClass =
  "w-full rounded-md border border-hairline bg-paper px-2 py-1 text-sm text-ink placeholder:text-ink-faint focus:border-accent focus:outline-none";

function NetworkField({
  network,
  assetCode,
  assetIssuer,
  patchNetworkAsset,
}: {
  network: string;
  assetCode: string | null;
  assetIssuer: string | null;
  patchNetworkAsset: (next: { network: string; assetCode: string; assetIssuer: string }) => void;
}) {
  return (
    <div className="rounded-lg border border-hairline bg-surface px-5 py-4">
      <label className="text-xs uppercase tracking-wide text-ink-faint">Network</label>
      <select
        value={network}
        onChange={(e) =>
          patchNetworkAsset({ network: e.target.value, assetCode: assetCode ?? "", assetIssuer: assetIssuer ?? "" })
        }
        className={`${cardFieldClass} mt-1.5`}
      >
        <option value="TESTNET">Testnet</option>
        <option value="PUBLIC">Public (Mainnet)</option>
      </select>
    </div>
  );
}

function AssetField({
  network,
  assetCode,
  assetIssuer,
  patchNetworkAsset,
}: {
  network: string;
  assetCode: string | null;
  assetIssuer: string | null;
  patchNetworkAsset: (next: { network: string; assetCode: string; assetIssuer: string }) => void;
}) {
  return (
    <div className="rounded-lg border border-hairline bg-surface px-5 py-4">
      <label className="text-xs uppercase tracking-wide text-ink-faint">Asset</label>
      <div key={`${assetCode}-${assetIssuer}`} className="mt-1.5 flex flex-col gap-1.5">
        <input
          defaultValue={assetCode ?? ""}
          onBlur={(e) => {
            const code = e.target.value.trim().toUpperCase();
            if (code !== (assetCode ?? "")) {
              patchNetworkAsset({ network, assetCode: code, assetIssuer: assetIssuer ?? "" });
            }
          }}
          placeholder="XLM"
          className={cardFieldClass}
        />
        <input
          defaultValue={assetIssuer ?? ""}
          onBlur={(e) => {
            const issuer = e.target.value.trim();
            if (issuer !== (assetIssuer ?? "")) {
              patchNetworkAsset({ network, assetCode: assetCode ?? "", assetIssuer: issuer });
            }
          }}
          placeholder="Issuer G..."
          className={`${cardFieldClass} font-mono text-xs`}
        />
      </div>
    </div>
  );
}

function PrepareSection({
  text,
  canEdit,
  onTextChange,
  flushPendingSave,
}: {
  text: string;
  canEdit: boolean;
  onTextChange: (text: string) => void;
  flushPendingSave: () => void;
}) {
  return (
    <div className="rounded-lg border border-hairline bg-surface p-6">
      <RecipientsEditor value={text} onChange={onTextChange} onBlur={flushPendingSave} readOnly={!canEdit} />
      <p className="mt-4 text-xs text-ink-faint">
        Addresses and account status are checked automatically as you edit — switch to Confirm once
        recipients look ready.
      </p>
    </div>
  );
}

function RecipientsTable({
  recipients,
  batch,
  busyRowIds,
  bulkBusy,
  refreshOne,
  copyAddress,
  txHashByRecipient,
}: {
  recipients: Recipient[];
  batch: Batch;
  busyRowIds: Set<string>;
  bulkBusy: string | null;
  refreshOne: (id: string) => void;
  copyAddress: (address: string) => void;
  txHashByRecipient: Map<string, string>;
}) {
  return (
    <div className="rounded-lg border border-hairline bg-surface">
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-hairline text-left text-xs uppercase tracking-wide text-ink-faint">
              <th className="w-10 px-3 py-3 font-medium">#</th>
              <th className="px-3 py-3 font-medium">Address</th>
              <th className="w-20 px-3 py-3 font-medium">Amount</th>
              <th className="w-20 px-3 py-3 font-medium">Created</th>
              <th className="w-28 px-3 py-3 font-medium">Balance</th>
              <th className="w-24 px-3 py-3 font-medium">Status</th>
              <th className="px-3 py-3 font-medium">Note</th>
              <th className="w-12 px-3 py-3 font-medium" />
            </tr>
          </thead>
          <tbody>
            {recipients.map((r) => (
              <tr key={r.id} className="border-b border-hairline last:border-0">
                <td className="px-3 py-3 tabular-nums text-ink-muted">{r.rowIndex}</td>
                <td className="px-3 py-3">
                  <div className="flex items-center gap-1">
                    <span className={`font-mono text-xs ${r.addressValid ? "text-success" : "text-danger"}`}>
                      {r.destination}
                    </span>
                    {r.destination && (
                      <>
                        <button
                          onClick={() => copyAddress(r.destination)}
                          title="Copy address"
                          className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-ink-faint hover:bg-sidebar hover:text-ink"
                        >
                          <CopyIcon />
                        </button>
                        <a
                          href={explorerAccountUrl(batch.network, r.destination)}
                          target="_blank"
                          rel="noopener noreferrer"
                          title="Open in explorer"
                          className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-ink-faint hover:bg-sidebar hover:text-ink"
                        >
                          <ExternalLinkIcon />
                        </a>
                      </>
                    )}
                    {r.isDuplicate && (
                      <span className="shrink-0 rounded-full bg-warning-soft px-2 py-0.5 text-[10px] font-medium text-warning">
                        dup
                      </span>
                    )}
                  </div>
                </td>
                <td className="px-3 py-3 tabular-nums text-ink">{r.amount}</td>
                <td className="px-3 py-3 text-ink-muted">
                  {r.accountExists === null ? "—" : r.accountExists ? "Yes" : "No"}
                </td>
                <td className="px-3 py-3 tabular-nums text-ink-muted">{r.currentBalance ?? "—"}</td>
                <td className="px-3 py-3">
                  <span className={`rounded-full px-2.5 py-1 text-xs font-medium ${statusPillClass(r.status)}`}>
                    {STATUS_LABEL[r.status] ?? r.status}
                  </span>
                </td>
                <td className="px-3 py-3 text-ink-muted">
                  {r.errorMessage}
                  {txHashByRecipient.has(r.id) && (
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
                <td className="px-3 py-3">
                  {r.addressValid && !r.isDuplicate && RECHECKABLE_STATUSES.has(r.status) && (
                    <button
                      onClick={() => refreshOne(r.id)}
                      disabled={busyRowIds.has(r.id) || bulkBusy !== null}
                      title="Refresh this address"
                      className="inline-flex h-8 w-8 items-center justify-center rounded-md border border-hairline text-ink-muted hover:bg-sidebar hover:text-ink disabled:opacity-40"
                    >
                      <RefreshIcon spinning={busyRowIds.has(r.id)} />
                    </button>
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
