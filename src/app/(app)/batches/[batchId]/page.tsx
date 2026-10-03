"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useParams, useRouter, useSearchParams } from "next/navigation";
import { toast } from "sonner";
import { useWallet } from "@/components/wallet/WalletProvider";
import { RecipientsEditor } from "@/components/batches/RecipientsEditor";
import { BatchStageNav, STAGES, stageFromStatus, type Stage } from "@/components/batches/BatchStageNav";
import { AssetField, NetworkField } from "@/components/batches/AssetFields";
import { explorerAccountUrl, explorerTxUrl } from "@/lib/stellar/explorer";
import { formatAmount, sumAmounts } from "@/lib/format";
import { useDistributionRun, type RunPhase } from "@/components/distribution/useDistributionRun";
import { DistributionProgress } from "@/components/distribution/DistributionProgress";
import { KindBadge } from "@/components/batches/KindBadge";
import { KindSwitch } from "@/components/batches/KindSwitch";
import { ClaimWindowPicker } from "@/components/batches/ClaimWindowPicker";
import { ClaimPill, ClaimStatusCard, type ClaimSummaryView } from "@/components/distribution/ClaimStatusCard";
import { isConvertible } from "@/lib/distribution/convertRules";
import { PreflightProblems, SendReviewCard } from "@/components/distribution/SendReviewCard";

// "channels" (default): one wallet signature, chunks sent in parallel by
// the channel engine. "legacy": the Phase 1 sequential sender, kept as
// the benchmark baseline and a fallback.
const SEND_ENGINE = process.env.NEXT_PUBLIC_SEND_ENGINE === "legacy" ? "legacy" : "channels";

const PHASE_LABEL: Partial<Record<RunPhase, string>> = {
  preparing: "Checking…",
  review: "Review below",
  "awaiting-signature": "Approve in your wallet…",
  authorizing: "Authorizing…",
  running: "Sending…",
};

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
  claimStatus?: "UNCLAIMED" | "CLAIMED" | "RECLAIMED" | null;
  claimTxHash?: string | null;
  claimableBalanceId?: string | null;
  channelItems?: { status: string; resultCode: string | null; transaction: { stellarTxHash: string | null; transactionHash: string } }[];
};

type RunSummary = { id: string; status: string; purpose: string; errorCode: string | null; signedAt: string | null; createdAt: string };

type AttemptItem = { recipientId: string; status: string };
type Attempt = { txHash: string | null; items: AttemptItem[] };

type Batch = {
  id: string;
  status: string;
  network: string;
  assetCode: string | null;
  assetIssuer: string | null;
  sourceAccount: string | null;
  csvFileName: string | null;
  createdAt: string;
  recipients: Recipient[];
  attempts: Attempt[];
  runs?: RunSummary[];
  kind?: "PAYMENT" | "CLAIMABLE_BALANCE";
  claimExpiresAt?: string | null;
  claimWindowDays?: number | null;
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

// A batch created via "New batch" has no csvFileName (nothing was ever
// uploaded) — falling back to the raw cuid there read as an internal
// implementation detail leaking into the UI, so this is what shows
// instead.
function formatCreatedAt(iso: string): string {
  const d = new Date(iso);
  return `Created ${d.toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })}`;
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
  const isDemo = useSearchParams().get("demo") === "1";
  const router = useRouter();
  const { login, signTransaction } = useWallet();
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
  const nextBtnRef = useRef<HTMLButtonElement>(null);
  const signSendBtnRef = useRef<HTMLButtonElement>(null);
  const [demoAnchor, setDemoAnchor] = useState<{
    top: number;
    left: number;
    placement: "above" | "below";
    arrowLeft: number;
  } | null>(null);
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

  const canEdit = batch ? batch.attempts.length === 0 && !(batch.runs ?? []).some((r) => r.signedAt) : false;
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

  // A batch drafted without a wallet has no `sourceAccount` yet — claim it
  // right here, at the last possible moment before a signature is needed,
  // instead of gating the whole page on a wallet. Try the claim first (a
  // session may already exist from earlier in this browser); only run the
  // full wallet login — which pops the signature prompt — if that 401s.
  const ensureClaimed = useCallback(async () => {
    const claim = () => fetch(`/api/batches/${batchId}/claim`, { method: "POST" });

    let res = await claim();
    if (res.status === 401) {
      await login();
      res = await claim();
    }
    if (!res.ok) throw new Error((await res.json()).error ?? "Couldn't claim this batch");
  }, [batchId, login]);

  const switchKind = useCallback(
    async (next: "PAYMENT" | "CLAIMABLE_BALANCE") => {
      setSaving(true);
      try {
        const res = await fetch(`/api/batches/${batchId}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ kind: next }),
        });
        if (!res.ok) throw new Error((await res.json()).error ?? "Could not change the type");
        await load();
        setPinnedStage("prepare");
        toast.success(next === "CLAIMABLE_BALANCE" ? "Sending as claimable balances" : "Sending as payments");
      } catch (err) {
        toast.error(err instanceof Error ? err.message : "Could not change the type");
      } finally {
        setSaving(false);
      }
    },
    [batchId, load]
  );

  const setClaimWindow = useCallback(
    async (days: number) => {
      setSaving(true);
      try {
        const res = await fetch(`/api/batches/${batchId}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ claimWindowDays: days }),
        });
        if (!res.ok) throw new Error((await res.json()).error ?? "Could not change the claim window");
        await load();
      } catch (err) {
        toast.error(err instanceof Error ? err.message : "Could not change the claim window");
      } finally {
        setSaving(false);
      }
    },
    [batchId, load]
  );

  const [claims, setClaims] = useState<ClaimSummaryView | null>(null);
  const [syncingClaims, setSyncingClaims] = useState(false);
  const syncClaims = useCallback(async () => {
    setSyncingClaims(true);
    try {
      const res = await fetch(`/api/batches/${batchId}/claims/sync`, { method: "POST" });
      if (!res.ok) return;
      setClaims((await res.json()).claims);
      await load();
    } finally {
      setSyncingClaims(false);
    }
  }, [batchId, load]);
  const hasBalances = !!batch?.recipients.some((r) => r.claimableBalanceId);
  const claimsSyncedRef = useRef(false);
  useEffect(() => {
    // Once per visit: read claim progress from the network.
    if (!hasBalances || claimsSyncedRef.current) return;
    claimsSyncedRef.current = true;
    const timer = setTimeout(() => void syncClaims(), 0);
    return () => clearTimeout(timer);
  }, [hasBalances, syncClaims]);

  const convertFailed = useCallback(async () => {
    setBulkBusy("convert");
    try {
      await ensureClaimed();
      const res = await fetch(`/api/batches/${batchId}/convert-failed`, { method: "POST" });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Could not create the claimable balance batch");
      toast.success(`${data.moved} row${data.moved === 1 ? "" : "s"} moved to a new claimable balance batch`);
      router.push(`/batches/${data.batchId}`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not create the claimable balance batch");
    } finally {
      setBulkBusy(null);
    }
  }, [batchId, ensureClaimed, router]);

  const distribution = useDistributionRun({
    signTransaction,
    ensureClaimed,
    onFinished: (run) => {
      void load().then(() => setPinnedStage(null));
      if (run.purpose === "RECLAIM") void syncClaims();
      if (run.status === "COMPLETED")
        toast.success(run.purpose === "CLEANUP" ? "Leftover signers removed" : run.purpose === "RECLAIM" ? "Unclaimed balances are back in your account" : "Distribution complete");
      else if (run.status === "PARTIALLY_FAILED") toast.warning("Some rows were not delivered. You can send them again.");
      else toast.error(run.errorMessage ?? "The distribution did not go through.");
    },
    // A failed start (e.g. preflight problems): reload so the rows it
    // flagged show their reason; the problems card lists them too.
    onError: () => {
      void load();
    },
  });
  const distributionActive = ["preparing", "review", "awaiting-signature", "authorizing", "running"].includes(distribution.phase);

  // Re-attach to a run that is still in flight when the page opens.
  const { watch: watchRun, phase: distributionPhase } = distribution;
  const cleanupRunId = batch?.runs?.find((r) => r.errorCode === "CLEANUP_REQUIRED")?.id;
  const inFlightRunId = batch?.runs?.find((r) => r.signedAt && ["SETUP_SUBMITTED", "SETUP_CONFIRMED", "PAYMENTS_SUBMITTING"].includes(r.status))?.id;
  useEffect(() => {
    if (inFlightRunId && distributionPhase === "idle") watchRun(inFlightRunId);
  }, [inFlightRunId, distributionPhase, watchRun]);

  const prepareAndSend = useCallback(async () => {
    if (SEND_ENGINE === "channels") {
      await distribution.prepare(batchId);
      return;
    }
    setBulkBusy("send");
    try {
      await ensureClaimed();
      const prepareRes = await fetch(`/api/batches/${batchId}/prepare`, { method: "POST" });
      if (!prepareRes.ok) throw new Error((await prepareRes.json()).error ?? "Prepare failed");
      const { attempts } = await prepareRes.json();

      for (const attempt of attempts) {
        // A payment chunk authorized via the master tx's preAuthTx
        // signers (see txBuilder.ts) needs no wallet signature — submit
        // it exactly as built.
        const signedXdr = attempt.requiresSignature ? await signTransaction(attempt.xdr) : attempt.xdr;
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
  }, [batchId, load, signTransaction, ensureClaimed, distribution]);

  const retryFailed = useCallback(async () => {
    const lastRun = batch?.runs?.find((r) => r.purpose === "SEND" || r.purpose === "REAUTHORIZE");
    if (SEND_ENGINE === "channels" && lastRun) {
      await distribution.reauthorize(lastRun.id);
      return;
    }
    setBulkBusy("retry");
    try {
      await ensureClaimed();
      const retryRes = await fetch(`/api/batches/${batchId}/retry`, { method: "POST" });
      if (!retryRes.ok) throw new Error((await retryRes.json()).error ?? "Retry failed");
      const { attempts } = await retryRes.json();

      for (const attempt of attempts) {
        // A payment chunk authorized via the master tx's preAuthTx
        // signers (see txBuilder.ts) needs no wallet signature — submit
        // it exactly as built.
        const signedXdr = attempt.requiresSignature ? await signTransaction(attempt.xdr) : attempt.xdr;
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
  }, [batchId, load, signTransaction, ensureClaimed, batch, distribution]);

  const refreshableCount = useMemo(() => {
    if (!batch) return 0;
    return batch.recipients.filter(
      (r) => r.addressValid && !r.isDuplicate && RECHECKABLE_STATUSES.has(r.status)
    ).length;
  }, [batch]);

  useEffect(() => {
    const stage = batch ? (pinnedStage ?? stageFromStatus(batch.status)) : null;
    const highlightNext = isDemo && stage === "prepare";
    const highlightSignSend = isDemo && stage === "confirm";
    const targetRef = highlightNext ? nextBtnRef : highlightSignSend ? signSendBtnRef : null;
    const target = targetRef?.current;
    if (!target) {
      setDemoAnchor(null);
      return;
    }
    const update = () => {
      const rect = target.getBoundingClientRect();
      const cardWidth = 288;
      const gap = 12;
      // Prefer placing above the target; flip below when there isn't room
      // (e.g. the Next button near the bottom of a short viewport).
      const placement: "above" | "below" = rect.top > 180 ? "above" : "below";
      const left = Math.min(
        Math.max(rect.left + rect.width / 2 - cardWidth / 2, 16),
        window.innerWidth - cardWidth - 16,
      );
      const top = placement === "above" ? rect.top - gap : rect.bottom + gap;
      const arrowLeft = Math.min(Math.max(rect.left + rect.width / 2 - left, 20), cardWidth - 20);
      setDemoAnchor({ top, left, placement, arrowLeft });
    };
    update();
    window.addEventListener("resize", update);
    window.addEventListener("scroll", update, true);
    return () => {
      window.removeEventListener("resize", update);
      window.removeEventListener("scroll", update, true);
    };
  }, [isDemo, batch, pinnedStage]);

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
  for (const r of batch.recipients) {
    const tx = r.channelItems?.find((i) => i.status === "SUCCESS")?.transaction;
    if (tx) txHashByRecipient.set(r.id, tx.stellarTxHash ?? tx.transactionHash);
  }
  const kind = batch.kind ?? "PAYMENT";
  const convertibleCount =
    kind === "PAYMENT"
      ? batch.recipients.filter((r) =>
          isConvertible({ ...r, lastResultCode: r.channelItems?.[0]?.resultCode ?? null }, !batch.assetCode)
        ).length
      : 0;

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

  const demoStepNumber = displayedStage === "prepare" ? 1 : displayedStage === "confirm" ? 2 : 3;
  const demoStepText =
    displayedStage === "prepare"
      ? "Review the pre-filled recipients, then click Next → below."
      : displayedStage === "confirm"
        ? "Click Sign & send. That's where your wallet connects and this becomes a real testnet transaction."
        : batch.attempts.length === 0
          ? "Head back to Confirm and click Sign & send to submit."
          : "Done. That was a real testnet transaction. Check the tx link on any recipient below.";
  const demoHighlightNext = isDemo && displayedStage === "prepare";
  const demoHighlightSignSend = isDemo && displayedStage === "confirm";

  return (
    <div className="flex flex-col gap-6">
      {isDemo && (
        <div
          className="fixed z-50 w-72 rounded-2xl border border-accent bg-surface p-4 shadow-lg"
          style={
            demoAnchor
              ? {
                  top: demoAnchor.top,
                  left: demoAnchor.left,
                  transform: demoAnchor.placement === "above" ? "translateY(-100%)" : undefined,
                }
              : { top: 80, right: 16 }
          }
        >
          {demoAnchor && (
            <div
              className={`absolute h-3 w-3 rotate-45 border-accent bg-surface ${
                demoAnchor.placement === "above"
                  ? "bottom-[-7px] border-r border-b"
                  : "top-[-7px] border-l border-t"
              }`}
              style={{ left: demoAnchor.arrowLeft - 6 }}
            />
          )}
          <p className="text-xs font-medium tracking-wide text-accent uppercase">
            Demo · Step {demoStepNumber} of 3
          </p>
          <p className="mt-1 text-sm text-ink">{demoStepText}</p>
        </div>
      )}
      <BatchStageNav current={displayedStage} onSelect={setPinnedStage} />

      <div>
        <h1 className="flex items-center gap-3 text-2xl font-semibold tracking-tight text-ink">
          {batch.kind === "CLAIMABLE_BALANCE" ? "Bulk claimable balance" : "Bulk payment"}
          <KindBadge kind={batch.kind ?? "PAYMENT"} />
        </h1>
        <p className="mt-1 flex items-center gap-2 text-sm text-ink-muted">
          {batch.csvFileName ?? formatCreatedAt(batch.createdAt)}
          {saving && <span className="text-xs text-ink-faint">Saving…</span>}
        </p>
        <div className="mt-4">
          <KindSwitch value={kind} disabled={!canEdit || saving || anyBusy || distributionActive} onChange={(next) => void switchKind(next)} />
        </div>
        {kind === "CLAIMABLE_BALANCE" && (
          <div className="mt-4">
            <ClaimWindowPicker
              value={batch.claimWindowDays ?? 30}
              disabled={!canEdit || saving || distributionActive}
              onChange={(days) => void setClaimWindow(days)}
            />
          </div>
        )}
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

      {distribution.phase === "error" && distribution.error && (
        <PreflightProblems
          error={distribution.error}
          rowNumberOf={(id) => {
            // The table numbers rows by position, not by their CSV line.
            const i = batch.recipients.findIndex((x) => x.id === id);
            return i >= 0 ? i + 1 : undefined;
          }}
          onDismiss={distribution.reset}
        />
      )}

      {distribution.phase === "review" && distribution.review && (
        <SendReviewCard
          review={distribution.review}
          error={distribution.error}
          busy={false}
          onApprove={distribution.approve}
          onCancel={() => void distribution.cancel().then(load)}
        />
      )}

      {["preparing", "awaiting-signature", "authorizing", "running", "done"].includes(distribution.phase) && (
        <DistributionProgress
          phase={distribution.phase}
          run={distribution.run}
          transactionCount={distribution.transactionCount}
          onDismiss={distribution.reset}
          onSendFailedAgain={distribution.run ? () => void distribution.reauthorize(distribution.run!.id) : undefined}
          onCleanup={distribution.run ? () => void distribution.cleanup(distribution.run!.id) : undefined}
        />
      )}

      {distribution.phase === "idle" && cleanupRunId && (
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-warning/30 bg-warning-soft px-5 py-3">
          <p className="text-sm text-warning">
            A past distribution left temporary signers on your account. They cannot move funds on their own, but they hold signer slots.
          </p>
          <button
            type="button"
            onClick={() => void distribution.cleanup(cleanupRunId)}
            className="cursor-pointer rounded-full border border-hairline bg-surface px-4 py-2 text-sm font-medium text-ink hover:bg-paper"
          >
            Remove leftover signers
          </button>
        </div>
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
                  className="w-36 rounded-xl border border-hairline bg-paper px-3 py-2 text-sm text-ink placeholder:text-ink-faint focus:border-accent focus:outline-none"
                />
                <button
                  onClick={() => applyAmountToAll(bulkAmount)}
                  disabled={!bulkAmount.trim()}
                  className="cursor-pointer rounded-full border border-hairline px-4 py-2 text-sm font-medium text-ink transition-colors hover:bg-sidebar disabled:cursor-not-allowed disabled:opacity-50"
                >
                  Set for all
                </button>
              </div>
            ) : (
              <span />
            )}
            <div className="flex flex-wrap justify-end gap-2">
              {convertibleCount > 0 && (
                <button
                  onClick={convertFailed}
                  disabled={anyBusy || distributionActive}
                  className="cursor-pointer rounded-full border border-hairline px-4 py-2 text-sm font-medium text-ink transition-colors hover:bg-sidebar disabled:cursor-not-allowed disabled:opacity-50"
                  title="These recipients have no trustline or account yet. A claimable balance lets them claim once they do."
                >
                  {bulkBusy === "convert" ? "Creating…" : `Send ${convertibleCount} as claimable balance`}
                </button>
              )}
              {refreshableCount > 0 && (
                <button
                  onClick={refreshAll}
                  disabled={anyBusy || distributionActive}
                  className="cursor-pointer rounded-full border border-hairline px-4 py-2 text-sm font-medium text-ink transition-colors hover:bg-sidebar disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {bulkBusy === "refresh-all" ? "Refreshing…" : `Refresh all (${refreshableCount})`}
                </button>
              )}
              {readyCount > 0 && (
                <button
                  ref={signSendBtnRef}
                  onClick={prepareAndSend}
                  disabled={anyBusy || distributionActive}
                  className={`accent-gradient cursor-pointer rounded-full px-4 py-2 text-sm font-medium text-white shadow-sm transition-transform hover:scale-[1.03] disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:scale-100 ${
                    demoHighlightSignSend ? "outline-2 outline-offset-2 outline-accent animate-pulse" : ""
                  }`}
                >
                  {bulkBusy === "send" ? "Sending…" : (PHASE_LABEL[distribution.phase] ?? `Sign & send (${readyCount})`)}
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
              Nothing&apos;s ready to send yet. Fix or refresh recipients on the Prepare tab first.
            </p>
          )}
        </div>
      )}

      {displayedStage === "send" && claims && claims.created > 0 && (
        <ClaimStatusCard
          summary={claims}
          syncing={syncingClaims}
          onRefresh={() => void syncClaims()}
          action={
            claims.unclaimed > 0 && claims.expiresAt && new Date(claims.expiresAt) <= new Date() ? (
              <button
                type="button"
                onClick={() => void distribution.reclaim(batchId)}
                disabled={distributionActive}
                className="accent-gradient cursor-pointer rounded-full px-4 py-2 text-sm font-medium text-white disabled:cursor-not-allowed disabled:opacity-50"
              >
                Reclaim {claims.unclaimed} unclaimed
              </button>
            ) : undefined
          }
        />
      )}

      {displayedStage === "send" && (
        <div className="flex flex-col gap-4">
          <div className="flex flex-wrap justify-end gap-2">
            {convertibleCount > 0 && (
              <button
                onClick={convertFailed}
                disabled={anyBusy || distributionActive}
                className="cursor-pointer rounded-full border border-hairline px-4 py-2 text-sm font-medium text-ink hover:bg-sidebar disabled:cursor-not-allowed disabled:opacity-50"
                title="These recipients have no trustline or account yet. A claimable balance lets them claim once they do."
              >
                {bulkBusy === "convert" ? "Creating…" : `Send ${convertibleCount} as claimable balance`}
              </button>
            )}
            {failedCount > 0 && (
              <button
                onClick={retryFailed}
                disabled={anyBusy || distributionActive}
                className="cursor-pointer rounded-full border border-danger/30 px-4 py-2 text-sm font-medium text-danger hover:bg-danger-soft disabled:cursor-not-allowed disabled:opacity-50"
              >
                {bulkBusy === "retry" ? "Retrying…" : (PHASE_LABEL[distribution.phase] ?? `Send failed rows again (${failedCount})`)}
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
              Nothing&apos;s been sent yet. Head to Confirm and sign to submit this batch.
            </p>
          )}
        </div>
      )}

      <div className="flex items-center justify-between border-t border-hairline pt-4">
        <button
          onClick={() => setPinnedStage(STAGES[stageIndex - 1].key)}
          disabled={stageIndex === 0}
          className="cursor-pointer rounded-full border border-hairline px-4 py-2 text-sm font-medium text-ink transition-colors hover:bg-sidebar disabled:cursor-not-allowed disabled:opacity-40"
        >
          ← Back
        </button>
        <button
          ref={nextBtnRef}
          onClick={() => setPinnedStage(STAGES[stageIndex + 1].key)}
          disabled={stageIndex === STAGES.length - 1}
          className={`cursor-pointer rounded-full border border-hairline px-4 py-2 text-sm font-medium text-ink transition-colors hover:bg-sidebar disabled:cursor-not-allowed disabled:opacity-40 ${
            demoHighlightNext ? "outline-2 outline-offset-2 outline-accent animate-pulse" : ""
          }`}
        >
          Next →
        </button>
      </div>
    </div>
  );
}

function InfoField({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="rounded-2xl border border-hairline bg-surface shadow-sm px-5 py-4">
      <p className="text-xs uppercase tracking-wide text-ink-faint">{label}</p>
      <div className="mt-1.5 text-sm font-medium text-ink">{value}</div>
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
    <div className="rounded-2xl border border-hairline bg-surface shadow-sm p-6">
      <RecipientsEditor value={text} onChange={onTextChange} onBlur={flushPendingSave} readOnly={!canEdit} />
      <p className="mt-4 text-xs text-ink-faint">
        Addresses and account status are checked automatically as you edit. Switch to Confirm once
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
    <div className="rounded-2xl border border-hairline bg-surface shadow-sm">
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
                            className="inline-flex h-7 w-7 shrink-0 cursor-pointer items-center justify-center rounded-full text-ink-faint transition-colors hover:bg-sidebar hover:text-ink"
                          >
                            <CopyIcon />
                          </button>
                          <a
                            href={explorerAccountUrl(batch.network, row.destination)}
                            target="_blank"
                            rel="noopener noreferrer"
                            title="Open in explorer"
                            className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-ink-faint transition-colors hover:bg-sidebar hover:text-ink"
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
                          className="inline-flex h-8 w-8 cursor-pointer items-center justify-center rounded-full border border-hairline text-ink-muted transition-colors hover:bg-sidebar hover:text-ink disabled:cursor-not-allowed disabled:opacity-40"
                        >
                          <RefreshIcon spinning={busyRowIds.has(r.id)} />
                        </button>
                      )}
                      {canEdit && !isBlank && (
                        <button
                          onClick={() => removeRow(row.id)}
                          title="Remove recipient"
                          className="inline-flex h-9 w-9 shrink-0 cursor-pointer items-center justify-center rounded-full text-lg leading-none text-ink-faint hover:bg-danger-soft hover:text-danger"
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
    <div className="rounded-2xl border border-hairline bg-surface shadow-sm">
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
                          className="inline-flex h-7 w-7 shrink-0 cursor-pointer items-center justify-center rounded-full text-ink-faint transition-colors hover:bg-sidebar hover:text-ink"
                        >
                          <CopyIcon />
                        </button>
                        <a
                          href={explorerAccountUrl(batch.network, r.destination)}
                          target="_blank"
                          rel="noopener noreferrer"
                          title="Open in explorer"
                          className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-ink-faint transition-colors hover:bg-sidebar hover:text-ink"
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
                  {r.claimStatus && (
                    <span className="ml-2 inline-block align-middle">
                      <ClaimPill status={r.claimStatus} href={r.claimTxHash ? explorerTxUrl(batch.network, r.claimTxHash) : null} />
                    </span>
                  )}
                </td>
                <td className="px-3 py-3">
                  {r.addressValid && !r.isDuplicate && RECHECKABLE_STATUSES.has(r.status) && (
                    <button
                      onClick={() => refreshOne(r.id)}
                      disabled={busyRowIds.has(r.id) || bulkBusy !== null}
                      title="Refresh this address"
                      className="inline-flex h-8 w-8 cursor-pointer items-center justify-center rounded-full border border-hairline text-ink-muted transition-colors hover:bg-sidebar hover:text-ink disabled:cursor-not-allowed disabled:opacity-40"
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
