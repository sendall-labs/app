"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useParams } from "next/navigation";
import { toast } from "sonner";
import { useWallet } from "@/components/wallet/WalletProvider";
import { RecipientsEditor } from "@/components/batches/RecipientsEditor";
import { BatchStageNav, STAGES, stageFromStatus, type Stage } from "@/components/batches/BatchStageNav";

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
  createdAt: string;
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
  COMPLETED: "bg-success-soft text-success",
  FAILED: "bg-danger-soft text-danger",
  CHECK_FAILED: "bg-danger-soft text-danger",
  VALIDATION_FAILED: "bg-danger-soft text-danger",
  PARTIAL_FAILURE: "bg-danger-soft text-danger",
};

const BATCH_STATUS_LABEL: Record<string, string> = {
  DRAFT: "Draft",
  VALIDATED: "Validated",
  CHECKING: "Checking…",
  READY: "Ready",
  SUBMITTING: "Sending…",
  COMPLETED: "Completed",
  PARTIAL_FAILURE: "Partial failure",
  FAILED: "Failed",
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

const DEFAULT_AMOUNT = "1";

/** Parses "destination,amount,memo" lines back into rows, preserving each
 * existing row's id by position so unedited/edited-in-place rows don't get
 * needlessly deleted and recreated server-side. A destination with no
 * amount yet (still typing, comma not reached) defaults to 1 instead of
 * flashing invalid the moment the address is finished. */
function textToRows(text: string, prevRows: EditableRow[]): EditableRow[] {
  return text.split(/\r?\n/).map((line, i) => {
    const [rawDestination = "", rawAmount = "", ...rest] = line.split(",");
    const destination = rawDestination.trim();
    return {
      id: prevRows[i]?.id ?? `new-${Date.now()}-${i}`,
      destination,
      amount: rawAmount.trim() || (destination ? DEFAULT_AMOUNT : ""),
      memo: rest.length > 0 ? rest.join(",").trim() || null : null,
    };
  });
}

function sumAmounts(rows: EditableRow[]): number {
  return rows.reduce((sum, r) => {
    const n = Number(r.amount);
    return sum + (Number.isFinite(n) ? n : 0);
  }, 0);
}

// A batch created via "New batch" has no csvFileName (nothing was ever
// uploaded) — falling back to the raw cuid there read as an internal
// implementation detail leaking into the UI, so this is what shows
// instead.
function formatCreatedAt(iso: string): string {
  const d = new Date(iso);
  return `Created ${d.toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })}`;
}

// Fixed to en-US regardless of the viewer's locale — every amount
// elsewhere in this app (the textarea, the recipient inputs, the raw CSV
// format) is period-decimal, so a locale like tr-TR rendering this as
// "23,7" would silently disagree with everything else on the page.
function formatAmount(n: number): string {
  return n.toLocaleString("en-US", { maximumFractionDigits: 7 });
}

type KnownAsset = {
  code: string;
  domain: string;
  accentClass: string;
  // null = native XLM, no issuer needed. Otherwise the verified issuer per
  // network — an asset not listed for a given network (AQUA has no
  // testnet entry below) is filtered out of the picker while that
  // network's selected, rather than showing an issuer that doesn't exist.
  issuer: Partial<Record<"TESTNET" | "PUBLIC", string>> | null;
};

// Every issuer here is verified against an official source — never invent
// one from memory, a wrong address silently misdirects funds:
// - USDC: developers.circle.com/stablecoins/usdc-contract-addresses
// - AQUA: aqua.network/.well-known/stellar.toml (mainnet only; Aquarius
//   doesn't run a testnet issuer)
const KNOWN_ASSETS: KnownAsset[] = [
  { code: "XLM", domain: "Stellar Network", accentClass: "bg-ink text-paper", issuer: null },
  {
    code: "USDC",
    domain: "circle.com",
    accentClass: "bg-[#2775CA] text-white",
    issuer: {
      PUBLIC: "GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN",
      TESTNET: "GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5",
    },
  },
  {
    code: "AQUA",
    domain: "aqua.network",
    accentClass: "bg-[#8B5CF6] text-white",
    issuer: { PUBLIC: "GBNZILSTVQZ4R7IKQDGHYGY2QXL5QOFJYQMXPKWRRM5PAV7Y4M67AQUA" },
  },
];

function findKnownAsset(code: string): KnownAsset | undefined {
  const upper = code.trim().toUpperCase();
  return KNOWN_ASSETS.find((a) => a.code === upper);
}

function issuerForNetwork(asset: KnownAsset, network: string): string | undefined {
  return asset.issuer?.[network as "TESTNET" | "PUBLIC"];
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
  // Same null-mirrors-server pattern, but for the Confirm screen's editable
  // table (destination/amount inputs per row) — separate from prepareText
  // since a table of discrete inputs isn't vulnerable to the round-trip
  // reformatting issue a single free-text field is.
  const [editedRows, setEditedRows] = useState<EditableRow[] | null>(null);
  const [saving, setSaving] = useState(false);
  const [bulkAmount, setBulkAmount] = useState("");
  const [pinnedStage, setPinnedStage] = useState<Stage | null>(null);
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pendingRowsRef = useRef<EditableRow[]>([]);
  const autoCheckingRef = useRef(false);
  // Mirrors editedRows so an async save's success handler can tell whether
  // the user has typed something newer since that save was kicked off —
  // read via ref (not state) because the handler runs later, after
  // whatever render captured its closure is long gone.
  const editedRowsRef = useRef<EditableRow[] | null>(null);
  const applyEditedRows = useCallback((next: EditableRow[] | null) => {
    editedRowsRef.current = next;
    setEditedRows(next);
  }, []);

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
            // Never resync destination/amount text from the response —
            // Confirm's status/balance/etc. columns already read live from
            // `batch` on every render regardless of editedRows, so the
            // only thing a freshly-created row still needs from this
            // response is its real id (so the *next* edit updates it
            // instead of creating a duplicate). Patch that in by position
            // and leave everything the user typed untouched — including a
            // save that landed on a momentarily-invalid value, which must
            // not visibly "correct itself" out from under a still-focused
            // field. Skipped entirely if a newer edit has since replaced
            // `current` (editedRowsRef would point elsewhere by now).
            if (editedRowsRef.current === current) {
              const idByOldRow = new Map<EditableRow, string>();
              nonEmpty.forEach((r, i) => {
                if (r.id.startsWith("new-") && updated.recipients[i]) {
                  idByOldRow.set(r, updated.recipients[i].id);
                }
              });
              if (idByOldRow.size > 0) {
                applyEditedRows(current.map((r) => (idByOldRow.has(r) ? { ...r, id: idByOldRow.get(r)! } : r)));
              }
            }
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
    [batchId, applyEditedRows]
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

  const confirmRows: EditableRow[] = useMemo(
    () => editedRows ?? (batch ? batch.recipients.map(recipientToRow) : []),
    [editedRows, batch]
  );

  // Editing a row that doesn't exist in confirmRows yet (the always-present
  // trailing blank row — see `displayConfirmRows` below) appends it instead
  // of no-op'ing, so typing straight into that last row is how a new
  // recipient gets added — no separate "add" affordance to click first.
  const updateRow = useCallback(
    (id: string, field: "destination" | "amount", value: string) => {
      const exists = confirmRows.some((r) => r.id === id);
      const next = exists
        ? confirmRows.map((r) => (r.id === id ? { ...r, [field]: value } : r))
        : [...confirmRows, { id, destination: "", amount: DEFAULT_AMOUNT, memo: null, [field]: value }];
      applyEditedRows(next);
      // Prepare's textarea caches its own raw text so it never reformats
      // mid-typing (see prepareText) — but that means it won't pick up a
      // change made here on its own. Drop the cache so switching to
      // Prepare re-derives from the freshly saved rows instead of showing
      // whatever was there before this edit.
      setPrepareText(null);
      scheduleSave(next);
    },
    [confirmRows, scheduleSave, applyEditedRows]
  );

  const removeRow = useCallback(
    (id: string) => {
      const next = confirmRows.filter((r) => r.id !== id);
      applyEditedRows(next);
      setPrepareText(null);
      if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
      persistRows(next);
    },
    [confirmRows, persistRows, applyEditedRows]
  );

  const applyAmountToAll = useCallback(
    (amount: string) => {
      if (!amount.trim() || confirmRows.length === 0) return;
      const next = confirmRows.map((r) => ({ ...r, amount: amount.trim() }));
      applyEditedRows(next);
      setPrepareText(null);
      if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
      persistRows(next);
    },
    [confirmRows, persistRows, applyEditedRows]
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
  const totalAmount = sumAmounts(draftRows);
  const recipientById = new Map(batch.recipients.map((r) => [r.id, r]));
  const stageIndex = STAGES.findIndex((s) => s.key === displayedStage);
  // A blank row always trails the list so typing straight into it is how
  // you add a recipient — id keyed off length so it's stable while blank
  // and rolls to a fresh one the instant it gets real content and a new
  // trailing row is needed.
  const displayConfirmRows = canEdit
    ? [...confirmRows, { id: `new-blank-${confirmRows.length}`, destination: "", amount: "", memo: null }]
    : confirmRows;

  return (
    <div className="flex flex-col gap-6">
      <BatchStageNav current={displayedStage} onSelect={setPinnedStage} />

      <div>
        <h1 className="font-serif text-2xl font-semibold text-ink">Batch review</h1>
        <p className="mt-1 flex items-center gap-2 text-sm text-ink-muted">
          {batch.csvFileName ?? formatCreatedAt(batch.createdAt)}
          {saving && <span className="text-xs text-ink-faint">Saving…</span>}
        </p>
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
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
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <InfoField label="Recipients" value={String(recipientCount)} />
        <InfoField
          label="Total to send"
          value={`${formatAmount(totalAmount)} ${batch.assetCode ?? "XLM"}`}
        />
        <InfoField
          label="Status"
          value={
            <span className={`rounded-full px-2.5 py-1 text-xs font-medium ${statusPillClass(batch.status)}`}>
              {BATCH_STATUS_LABEL[batch.status] ?? batch.status}
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
          <div className="flex flex-wrap items-center justify-between gap-2">
            {canEdit && confirmRows.length > 0 ? (
              <div className="flex items-center gap-2">
                <input
                  value={bulkAmount}
                  onChange={(e) => setBulkAmount(e.target.value)}
                  placeholder="Amount for all"
                  inputMode="decimal"
                  className="w-36 rounded-md border border-hairline bg-paper px-3 py-2 text-sm text-ink placeholder:text-ink-faint focus:border-accent focus:outline-none"
                />
                <button
                  onClick={() => applyAmountToAll(bulkAmount)}
                  disabled={!bulkAmount.trim()}
                  className="cursor-pointer rounded-md border border-hairline px-4 py-2 text-sm font-medium text-ink hover:bg-sidebar disabled:cursor-not-allowed disabled:opacity-50"
                >
                  Set for all
                </button>
              </div>
            ) : (
              <span />
            )}
            <div className="flex flex-wrap justify-end gap-2">
              {refreshableCount > 0 && (
                <button
                  onClick={refreshAll}
                  disabled={anyBusy}
                  className="cursor-pointer rounded-md border border-hairline px-4 py-2 text-sm font-medium text-ink hover:bg-sidebar disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {bulkBusy === "refresh-all" ? "Refreshing…" : `Refresh all (${refreshableCount})`}
                </button>
              )}
              {readyCount > 0 && (
                <button
                  onClick={prepareAndSend}
                  disabled={anyBusy}
                  className="cursor-pointer rounded-md bg-accent px-4 py-2 text-sm font-medium text-accent-ink hover:bg-accent-hover disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {bulkBusy === "send" ? "Sending…" : `Sign & send (${readyCount})`}
                </button>
              )}
            </div>
          </div>
          <EditableRecipientsTable
            rows={displayConfirmRows}
            recipientById={recipientById}
            batch={batch}
            canEdit={canEdit}
            busyRowIds={busyRowIds}
            bulkBusy={bulkBusy}
            refreshOne={refreshOne}
            copyAddress={copyAddress}
            txHashByRecipient={txHashByRecipient}
            updateRow={updateRow}
            removeRow={removeRow}
            flushPendingSave={flushPendingSave}
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
                className="cursor-pointer rounded-md border border-danger/30 px-4 py-2 text-sm font-medium text-danger hover:bg-danger-soft disabled:cursor-not-allowed disabled:opacity-50"
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

      <div className="flex items-center justify-between border-t border-hairline pt-4">
        <button
          onClick={() => setPinnedStage(STAGES[stageIndex - 1].key)}
          disabled={stageIndex === 0}
          className="cursor-pointer rounded-md border border-hairline px-4 py-2 text-sm font-medium text-ink hover:bg-sidebar disabled:cursor-not-allowed disabled:opacity-40"
        >
          ← Back
        </button>
        <button
          onClick={() => setPinnedStage(STAGES[stageIndex + 1].key)}
          disabled={stageIndex === STAGES.length - 1}
          className="cursor-pointer rounded-md border border-hairline px-4 py-2 text-sm font-medium text-ink hover:bg-sidebar disabled:cursor-not-allowed disabled:opacity-40"
        >
          Next →
        </button>
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
    <div className="flex flex-col justify-center rounded-lg border border-hairline bg-surface px-5 py-4">
      <label className="text-xs uppercase tracking-wide text-ink-faint">Network</label>
      <select
        value={network}
        onChange={(e) => {
          const nextNetwork = e.target.value;
          // A known asset's issuer differs by network — re-resolve it for
          // whichever network is being switched to instead of carrying the
          // old (now wrong) one over. A custom/unrecognized issuer is left
          // exactly as the user entered it.
          const known = assetCode ? findKnownAsset(assetCode) : undefined;
          const nextIssuer = known ? (issuerForNetwork(known, nextNetwork) ?? "") : (assetIssuer ?? "");
          patchNetworkAsset({ network: nextNetwork, assetCode: assetCode ?? "", assetIssuer: nextIssuer });
        }}
        className={`${cardFieldClass} mt-1.5`}
      >
        <option value="TESTNET">Testnet</option>
        <option value="PUBLIC">Public (Mainnet)</option>
      </select>
    </div>
  );
}

function AssetIcon({ code, accentClass }: { code: string; accentClass: string }) {
  if (code === "XLM") {
    return (
      <span className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-full ${accentClass}`}>
        <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="1.6">
          <path
            d="M5 15.5 19 8M5 15.5l3.2-1M5 15.5l1-3.2M19 8l-3.2 1M19 8l-1 3.2"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      </span>
    );
  }
  return (
    <span
      className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-xs font-semibold ${accentClass}`}
    >
      {code.slice(0, 1)}
    </span>
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
  // Blank defaults to native XLM — shown as "XLM" outright rather than an
  // empty box the user has to already know means the same thing.
  const currentCode = assetCode ?? "XLM";
  const known = findKnownAsset(currentCode);
  const [mode, setMode] = useState<"search" | "custom">(currentCode !== "XLM" && !known ? "custom" : "search");
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (e: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) setOpen(false);
    };
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("mousedown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [open]);

  const visibleAssets = KNOWN_ASSETS.filter((a) => a.issuer === null || issuerForNetwork(a, network));
  const filtered = visibleAssets.filter((a) => {
    const q = query.trim().toLowerCase();
    if (!q) return true;
    return a.code.toLowerCase().includes(q) || a.domain.toLowerCase().includes(q);
  });

  const selectAsset = (asset: KnownAsset) => {
    patchNetworkAsset({
      network,
      assetCode: asset.code === "XLM" ? "" : asset.code,
      assetIssuer: issuerForNetwork(asset, network) ?? "",
    });
    setOpen(false);
    setQuery("");
  };

  if (mode === "custom") {
    return (
      <div className="rounded-lg border border-hairline bg-surface px-5 py-4">
        <div className="flex items-center justify-between">
          <label className="text-xs uppercase tracking-wide text-ink-faint">Asset</label>
          <button
            type="button"
            onClick={() => setMode("search")}
            className="cursor-pointer text-xs font-medium text-accent hover:underline"
          >
            Browse known assets
          </button>
        </div>
        <div key={`${assetCode}-${assetIssuer}`} className="mt-2 flex flex-col gap-1.5">
          <input
            defaultValue={currentCode === "XLM" ? "" : currentCode}
            onBlur={(e) => {
              const code = e.target.value.trim().toUpperCase();
              if (!code || code === "XLM") {
                if (assetCode) patchNetworkAsset({ network, assetCode: "", assetIssuer: "" });
                setMode("search");
                return;
              }
              const match = findKnownAsset(code);
              if (match?.issuer) {
                patchNetworkAsset({ network, assetCode: code, assetIssuer: issuerForNetwork(match, network) ?? "" });
                setMode("search");
              } else if (code !== currentCode) {
                patchNetworkAsset({ network, assetCode: code, assetIssuer: "" });
              }
            }}
            placeholder="Asset code"
            className={cardFieldClass}
          />
          <input
            defaultValue={assetIssuer ?? ""}
            onBlur={(e) => {
              const issuer = e.target.value.trim();
              if (issuer !== (assetIssuer ?? "")) {
                patchNetworkAsset({ network, assetCode: currentCode, assetIssuer: issuer });
              }
            }}
            placeholder="Issuer G..."
            className={`${cardFieldClass} font-mono text-xs`}
          />
        </div>
      </div>
    );
  }

  return (
    <div ref={rootRef} className="relative rounded-lg border border-hairline bg-surface px-5 py-4">
      <label className="text-xs uppercase tracking-wide text-ink-faint">Asset</label>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="mt-2 flex w-full cursor-pointer items-center gap-3 rounded-md border border-hairline bg-paper px-3 py-2 text-left hover:border-accent"
      >
        <AssetIcon code={currentCode} accentClass={known?.accentClass ?? "bg-sidebar text-ink-muted"} />
        <span className="min-w-0 flex-1">
          <span className="block text-sm font-medium text-ink">{currentCode}</span>
          <span className="block truncate text-xs text-ink-faint">{known?.domain ?? "Custom asset"}</span>
        </span>
        <svg
          viewBox="0 0 20 20"
          className={`h-4 w-4 shrink-0 text-ink-faint transition-transform ${open ? "rotate-180" : ""}`}
          fill="none"
          stroke="currentColor"
          strokeWidth="1.6"
        >
          <path d="M5 7.5 10 12.5 15 7.5" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </button>

      {open && (
        <div className="absolute left-0 top-full z-20 mt-1 w-full rounded-lg border border-hairline bg-surface shadow-lg">
          <div className="flex items-center gap-2 border-b border-hairline px-3 py-2">
            <svg viewBox="0 0 20 20" className="h-4 w-4 shrink-0 text-ink-faint" fill="none" stroke="currentColor" strokeWidth="1.6">
              <circle cx="9" cy="9" r="6" />
              <path d="m17 17-4-4" strokeLinecap="round" />
            </svg>
            <input
              autoFocus
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Type asset name or code"
              className="flex-1 bg-transparent text-sm text-ink placeholder:text-ink-faint focus:outline-none"
            />
            {query && (
              <button
                type="button"
                onClick={() => setQuery("")}
                className="cursor-pointer text-ink-faint hover:text-ink"
              >
                ×
              </button>
            )}
          </div>
          <p className="px-3 pt-2 text-[11px] font-medium uppercase tracking-wide text-ink-faint">Known assets</p>
          <div className="max-h-64 overflow-y-auto py-1">
            {filtered.map((a) => (
              <button
                key={a.code}
                type="button"
                onClick={() => selectAsset(a)}
                className="flex w-full cursor-pointer items-center gap-3 px-3 py-2 text-left hover:bg-sidebar"
              >
                <AssetIcon code={a.code} accentClass={a.accentClass} />
                <span className="min-w-0 flex-1">
                  <span className="block text-sm font-medium text-ink">{a.code}</span>
                  <span className="block truncate text-xs text-ink-faint">{a.domain}</span>
                </span>
              </button>
            ))}
            {filtered.length === 0 && (
              <p className="px-3 py-4 text-center text-xs text-ink-faint">No known assets match &ldquo;{query}&rdquo;.</p>
            )}
          </div>
          <button
            type="button"
            onClick={() => {
              setOpen(false);
              setMode("custom");
            }}
            className="block w-full cursor-pointer border-t border-hairline px-3 py-2 text-left text-xs font-medium text-accent hover:underline"
          >
            + Enter a custom asset
          </button>
        </div>
      )}
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

function EditableRecipientsTable({
  rows,
  recipientById,
  batch,
  canEdit,
  busyRowIds,
  bulkBusy,
  refreshOne,
  copyAddress,
  txHashByRecipient,
  updateRow,
  removeRow,
  flushPendingSave,
}: {
  rows: EditableRow[];
  recipientById: Map<string, Recipient>;
  batch: Batch;
  canEdit: boolean;
  busyRowIds: Set<string>;
  bulkBusy: string | null;
  refreshOne: (id: string) => void;
  copyAddress: (address: string) => void;
  txHashByRecipient: Map<string, string>;
  updateRow: (id: string, field: "destination" | "amount", value: string) => void;
  removeRow: (id: string) => void;
  flushPendingSave: () => void;
}) {
  return (
    <div className="rounded-lg border border-hairline bg-surface">
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-hairline text-left text-xs uppercase tracking-wide text-ink-faint">
              <th className="w-10 px-3 py-3 font-medium">#</th>
              <th className="px-3 py-3 font-medium">Address</th>
              <th className="w-24 px-3 py-3 font-medium">Amount</th>
              <th className="w-20 px-3 py-3 font-medium">Created</th>
              <th className="w-28 px-3 py-3 font-medium">Balance</th>
              <th className="w-24 px-3 py-3 font-medium">Status</th>
              <th className="px-3 py-3 font-medium">Note</th>
              <th className="w-20 px-3 py-3 font-medium" />
            </tr>
          </thead>
          <tbody>
            {rows.map((row, i) => {
              const r = recipientById.get(row.id);
              const isNew = !r;
              const isBlank = !row.destination.trim() && !row.amount.trim();
              return (
                <tr key={row.id} className="border-b border-hairline last:border-0">
                  <td className="px-3 py-3 tabular-nums text-ink-muted">{r?.rowIndex ?? i + 1}</td>
                  <td className="px-3 py-3">
                    <div className="flex items-center gap-1">
                      {canEdit ? (
                        <input
                          value={row.destination}
                          onChange={(e) => updateRow(row.id, "destination", e.target.value)}
                          onBlur={flushPendingSave}
                          placeholder="G..."
                          className={`min-w-0 flex-1 rounded border border-transparent bg-transparent px-1 py-1 font-mono text-xs hover:border-hairline focus:border-accent focus:outline-none ${
                            isNew ? "text-ink" : r.addressValid ? "text-success" : "text-danger"
                          }`}
                        />
                      ) : (
                        <span className={`font-mono text-xs ${r?.addressValid ? "text-success" : "text-danger"}`}>
                          {row.destination}
                        </span>
                      )}
                      {row.destination && (
                        <>
                          <button
                            onClick={() => copyAddress(row.destination)}
                            title="Copy address"
                            className="inline-flex h-7 w-7 shrink-0 cursor-pointer items-center justify-center rounded-md text-ink-faint hover:bg-sidebar hover:text-ink"
                          >
                            <CopyIcon />
                          </button>
                          <a
                            href={explorerAccountUrl(batch.network, row.destination)}
                            target="_blank"
                            rel="noopener noreferrer"
                            title="Open in explorer"
                            className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-ink-faint hover:bg-sidebar hover:text-ink"
                          >
                            <ExternalLinkIcon />
                          </a>
                        </>
                      )}
                      {r?.isDuplicate && (
                        <span className="shrink-0 rounded-full bg-warning-soft px-2 py-0.5 text-[10px] font-medium text-warning">
                          dup
                        </span>
                      )}
                    </div>
                  </td>
                  <td className="px-3 py-3 tabular-nums text-ink">
                    {canEdit ? (
                      <input
                        value={row.amount}
                        onChange={(e) => updateRow(row.id, "amount", e.target.value)}
                        onBlur={flushPendingSave}
                        placeholder="0"
                        inputMode="decimal"
                        className="w-full rounded border border-transparent bg-transparent px-1 py-1 tabular-nums hover:border-hairline focus:border-accent focus:outline-none"
                      />
                    ) : (
                      row.amount
                    )}
                  </td>
                  <td className="px-3 py-3 text-ink-muted">
                    {isNew ? "—" : r.accountExists === null ? "—" : r.accountExists ? "Yes" : "No"}
                  </td>
                  <td className="px-3 py-3 tabular-nums text-ink-muted">{isNew ? "—" : (r.currentBalance ?? "—")}</td>
                  <td className="px-3 py-3">
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
                  <td className="px-3 py-3 text-ink-muted">
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
                  <td className="px-3 py-3">
                    <div className="flex items-center gap-1">
                      {r && r.addressValid && !r.isDuplicate && RECHECKABLE_STATUSES.has(r.status) && (
                        <button
                          onClick={() => refreshOne(r.id)}
                          disabled={busyRowIds.has(r.id) || bulkBusy !== null}
                          title="Refresh this address"
                          className="inline-flex h-8 w-8 cursor-pointer items-center justify-center rounded-md border border-hairline text-ink-muted hover:bg-sidebar hover:text-ink disabled:cursor-not-allowed disabled:opacity-40"
                        >
                          <RefreshIcon spinning={busyRowIds.has(r.id)} />
                        </button>
                      )}
                      {canEdit && !isBlank && (
                        <button
                          onClick={() => removeRow(row.id)}
                          title="Remove recipient"
                          className="inline-flex h-9 w-9 shrink-0 cursor-pointer items-center justify-center rounded-md text-lg leading-none text-ink-faint hover:bg-danger-soft hover:text-danger"
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
                          className="inline-flex h-7 w-7 shrink-0 cursor-pointer items-center justify-center rounded-md text-ink-faint hover:bg-sidebar hover:text-ink"
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
                      className="inline-flex h-8 w-8 cursor-pointer items-center justify-center rounded-md border border-hairline text-ink-muted hover:bg-sidebar hover:text-ink disabled:cursor-not-allowed disabled:opacity-40"
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
