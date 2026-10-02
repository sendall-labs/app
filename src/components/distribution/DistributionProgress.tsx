"use client";

import { useEffect, useState } from "react";
import type { RunView } from "@/lib/distribution/batchRuns";
import { explorerTxUrl } from "@/lib/stellar/explorer";
import type { RunPhase } from "./useDistributionRun";

type StageState = "pending" | "active" | "done" | "failed";

type Stage = { key: string; title: string; detail: string; state: StageState };

const TERMINAL_OK = new Set(["COMPLETED"]);

function stagesFor(phase: RunPhase, run: RunView | null): Stage[] {
  const signed = !!run?.signedAt || phase === "authorizing" || phase === "running" || phase === "done";
  const setupDone = !!run?.setup.confirmedAt;
  const setupFailed = !!run && !setupDone && run.terminal && run.status !== "COMPLETED";
  const sending = run?.status === "PAYMENTS_SUBMITTING" || run?.status === "SETUP_CONFIRMED";
  const ended = !!run?.terminal && setupDone;

  return [
    {
      key: "checks",
      title: "Final checks",
      detail: "Balances, trustlines and signer slots, before anything is signed",
      state: phase === "preparing" ? "active" : "done",
    },
    {
      key: "wallet",
      title: "Wallet approval",
      detail: "One signature authorizes every transaction in this distribution",
      state: phase === "awaiting-signature" ? "active" : signed ? "done" : "pending",
    },
    {
      key: "authorize",
      title: "Authorization confirming",
      detail: "The approval lands on-chain; Sendall covers the fee and the temporary reserve",
      state: setupFailed ? "failed" : setupDone ? "done" : signed ? "active" : "pending",
    },
    {
      key: "send",
      title: "Transactions processing",
      detail: "Each transaction goes out from its own channel, several at a time",
      state: ended ? (run!.status === "COMPLETED" ? "done" : run!.recipients.succeeded > 0 ? "done" : "failed") : sending ? "active" : "pending",
    },
  ];
}

function useElapsed(run: RunView | null) {
  const [now, setNow] = useState(() => Date.now());
  const running = !!run?.signedAt && !run.terminal;
  useEffect(() => {
    if (!running) return;
    const timer = setInterval(() => setNow(Date.now()), 200);
    return () => clearInterval(timer);
  }, [running]);
  if (!run?.signedAt) return null;
  const start = new Date(run.signedAt).getTime();
  const end = run.completedAt ? new Date(run.completedAt).getTime() : run.terminal ? start + (run.elapsedMs ?? 0) : now;
  return Math.max(0, end - start);
}

function formatElapsed(ms: number) {
  const s = ms / 1000;
  return s < 60 ? `${s.toFixed(1)}s` : `${Math.floor(s / 60)}m ${Math.round(s % 60)}s`;
}

function StageDot({ state }: { state: StageState }) {
  if (state === "done") {
    return (
      <span className="send-pop flex h-7 w-7 items-center justify-center rounded-full bg-success text-white">
        <svg viewBox="0 0 20 20" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2.2">
          <path d="m5 10.5 3.2 3L15 6.5" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </span>
    );
  }
  if (state === "failed") {
    return (
      <span className="send-pop flex h-7 w-7 items-center justify-center rounded-full bg-danger text-white">
        <svg viewBox="0 0 20 20" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2.2">
          <path d="M6 6l8 8M14 6l-8 8" strokeLinecap="round" />
        </svg>
      </span>
    );
  }
  if (state === "active") {
    return (
      <span className="relative flex h-7 w-7 items-center justify-center">
        <span className="send-ping absolute inset-0 rounded-full bg-accent" />
        <span className="accent-gradient relative h-3.5 w-3.5 rounded-full" />
      </span>
    );
  }
  return (
    <span className="flex h-7 w-7 items-center justify-center">
      <span className="h-3 w-3 rounded-full border-2 border-hairline" />
    </span>
  );
}

const LANE_LABEL: Record<string, string> = {
  PREPARED: "Queued",
  SUBMITTING: "Sending",
  SUCCESS: "Confirmed",
  FAILED: "Failed",
  REAUTHORIZATION_REQUIRED: "Failed",
  EXPIRED: "Not sent",
};

const LANE_TONE: Record<string, string> = {
  PREPARED: "text-ink-faint",
  SUBMITTING: "text-accent",
  SUCCESS: "text-success",
  FAILED: "text-danger",
  REAUTHORIZATION_REQUIRED: "text-danger",
  EXPIRED: "text-warning",
};

function Lane({ tx, network }: { tx: RunView["transactions"][number]; network: string }) {
  const settled = tx.status === "SUCCESS";
  const failed = ["FAILED", "REAUTHORIZATION_REQUIRED", "EXPIRED"].includes(tx.status);
  return (
    <li className="send-rise flex items-center gap-3 rounded-xl border border-hairline bg-paper px-3 py-2" style={{ animationDelay: `${tx.chunkIndex * 40}ms` }}>
      <span className="w-14 shrink-0 text-xs font-medium tabular-nums text-ink-muted">Tx {tx.chunkIndex + 1}</span>
      <div className="relative h-2 flex-1 overflow-hidden rounded-full bg-sidebar">
        {settled && <div className="absolute inset-0 rounded-full bg-success transition-all duration-500" />}
        {failed && <div className="absolute inset-0 rounded-full bg-danger/70" />}
        {tx.status === "SUBMITTING" && (
          <>
            <div className="absolute inset-y-0 left-0 w-1/2 rounded-full bg-accent/30" />
            <div className="send-shimmer absolute inset-y-0 left-0 w-2/5 rounded-full bg-gradient-to-r from-transparent via-accent to-transparent" />
          </>
        )}
      </div>
      <span className="w-16 shrink-0 text-right text-xs tabular-nums text-ink-faint">{tx.operationCount} rows</span>
      <span className={`w-20 shrink-0 text-right text-xs font-medium ${LANE_TONE[tx.status] ?? "text-ink-muted"}`}>
        {LANE_LABEL[tx.status] ?? tx.status}
      </span>
      {settled ? (
        <a
          href={explorerTxUrl(network, tx.hash)}
          target="_blank"
          rel="noreferrer"
          className="w-16 shrink-0 text-right font-mono text-xs text-accent hover:underline"
          title={tx.hash}
        >
          {tx.hash.slice(0, 6)}…
        </a>
      ) : (
        <span className="w-16 shrink-0" />
      )}
    </li>
  );
}

/**
 * Animated, step-by-step view of a distribution while it happens: final
 * checks, the single wallet approval, the authorization landing on-chain,
 * then one lane per transaction filling in as each confirms.
 */
export function DistributionProgress({
  phase,
  run,
  transactionCount,
  onDismiss,
  onSendFailedAgain,
  onCleanup,
}: {
  phase: RunPhase;
  run: RunView | null;
  transactionCount: number;
  onDismiss?: () => void;
  onSendFailedAgain?: () => void;
  onCleanup?: () => void;
}) {
  const stages = stagesFor(phase, run);
  const elapsed = useElapsed(run);
  const total = run?.recipients.total ?? 0;
  const settled = (run?.recipients.succeeded ?? 0) + (run?.recipients.failed ?? 0);
  const pct = total > 0 ? Math.round((settled / total) * 100) : 0;
  const lanes = run?.transactions ?? [];
  const ended = !!run?.terminal;
  const ok = ended && TERMINAL_OK.has(run!.status);

  return (
    <section aria-live="polite" aria-label="Distribution progress" className="send-rise rounded-2xl border border-hairline bg-surface p-5 shadow-sm">
      <header className="flex flex-wrap items-baseline justify-between gap-2">
        <div>
          <h2 className="text-base font-semibold text-ink">
            {ended
              ? ok
                ? "Distribution complete"
                : run!.status === "PARTIALLY_FAILED"
                  ? "Distribution partly delivered"
                  : "Distribution did not go through"
              : "Sending your distribution"}
          </h2>
          <p className="mt-0.5 text-xs text-ink-muted">
            {run
              ? `${run.recipients.succeeded} of ${total} delivered`
              : transactionCount
                ? `${transactionCount} Stellar transaction${transactionCount === 1 ? "" : "s"}`
                : "Checking your list"}
            {run?.network === "PUBLIC" ? " on Mainnet" : run ? " on Testnet" : ""}
          </p>
        </div>
        <div className="flex items-center gap-3">
          {elapsed !== null && (
            <span className="rounded-full bg-sidebar px-3 py-1 font-mono text-xs tabular-nums text-ink" title="From your signature to the last confirmation">
              {formatElapsed(elapsed)}
            </span>
          )}
          {ended && onDismiss && (
            <button type="button" onClick={onDismiss} className="cursor-pointer text-xs font-medium text-ink-muted hover:text-ink">
              Dismiss
            </button>
          )}
        </div>
      </header>

      <ol className="mt-5 grid gap-3 sm:grid-cols-4">
        {stages.map((stage, i) => (
          <li key={stage.key} className="relative flex gap-3 sm:flex-col sm:gap-2">
            <div className="flex items-center gap-2">
              <StageDot state={stage.state} />
              {i < stages.length - 1 && (
                <span className={`hidden h-0.5 flex-1 rounded-full sm:block ${stage.state === "done" ? "bg-success" : "bg-hairline"}`} />
              )}
            </div>
            <div>
              <p className={`text-sm font-medium ${stage.state === "pending" ? "text-ink-faint" : "text-ink"}`}>{stage.title}</p>
              <p className="mt-0.5 text-xs text-ink-muted">{stage.detail}</p>
            </div>
          </li>
        ))}
      </ol>

      {run && (
        <div className="mt-5">
          <div className="flex items-center justify-between text-xs text-ink-muted">
            <span>Recipients</span>
            <span className="tabular-nums">{pct}%</span>
          </div>
          <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-sidebar">
            <div
              className={`h-full rounded-full transition-[width] duration-700 ease-out ${run.recipients.failed > 0 && ended ? "bg-warning" : "accent-gradient"}`}
              style={{ width: `${pct}%` }}
            />
          </div>
        </div>
      )}

      {lanes.length > 0 && (
        <ul className="mt-4 flex max-h-80 flex-col gap-1.5 overflow-y-auto pr-1">
          {lanes.map((tx) => (
            <Lane key={tx.chunkIndex} tx={tx} network={run!.network} />
          ))}
        </ul>
      )}

      {ended && !ok && (
        <div className="mt-4 flex flex-wrap items-center justify-between gap-3 rounded-xl bg-sidebar px-4 py-3">
          <p className="text-sm text-ink">
            {run!.cleanupRequired
              ? "Some transactions were never sent, so their temporary signers are still on your account. Remove them with one more signature."
              : run!.recipients.failed > 0
                ? `${run!.recipients.failed} row${run!.recipients.failed === 1 ? " was" : "s were"} not delivered. They need a new approval to go out again.`
                : (run!.errorMessage ?? "The distribution did not go through.")}
          </p>
          <div className="flex gap-2">
            {run!.cleanupRequired && onCleanup && (
              <button type="button" onClick={onCleanup} className="cursor-pointer rounded-full border border-hairline bg-surface px-4 py-2 text-sm font-medium text-ink hover:bg-paper">
                Remove leftover signers
              </button>
            )}
            {run!.recipients.failed > 0 && onSendFailedAgain && (
              <button type="button" onClick={onSendFailedAgain} className="accent-gradient cursor-pointer rounded-full px-4 py-2 text-sm font-medium text-white">
                Send failed rows again
              </button>
            )}
          </div>
        </div>
      )}

      {run?.setup.txHash && (
        <p className="mt-3 text-xs text-ink-faint">
          Authorization{" "}
          <a href={explorerTxUrl(run.network, run.setup.txHash)} target="_blank" rel="noreferrer" className="font-mono text-accent hover:underline">
            {run.setup.txHash.slice(0, 10)}…
          </a>
        </p>
      )}
    </section>
  );
}
