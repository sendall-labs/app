"use client";

import { useEffect, useState } from "react";
import type { ReviewInfo, RunRequestError } from "./useDistributionRun";

function useCountdown(until: number) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, []);
  return Math.max(0, until - now);
}

function Row({ label, value, hint }: { label: string; value: React.ReactNode; hint?: string }) {
  return (
    <div className="flex items-baseline justify-between gap-4 py-2">
      <dt className="text-sm text-ink-muted">
        {label}
        {hint && <span className="block text-xs text-ink-faint">{hint}</span>}
      </dt>
      <dd className="text-right text-sm font-medium tabular-nums text-ink">{value}</dd>
    </div>
  );
}

/**
 * The last screen before the wallet opens: what is about to be sent, on
 * which network, and who pays for what. Nothing is signed until
 * "Approve in wallet".
 */
export function SendReviewCard({
  review,
  network,
  error,
  busy,
  onApprove,
  onCancel,
}: {
  review: ReviewInfo;
  network: "TESTNET" | "PUBLIC";
  error: RunRequestError | null;
  busy: boolean;
  onApprove: () => void;
  onCancel: () => void;
}) {
  const left = useCountdown(review.expiresAt);
  const expired = left === 0;
  const mins = Math.floor(left / 60000);
  const secs = Math.floor((left % 60000) / 1000)
    .toString()
    .padStart(2, "0");
  const s = review.summary;
  const p = review.preflight;
  const cleanup = review.purpose === "CLEANUP";
  const reclaim = review.purpose === "RECLAIM";
  const mainnet = network === "PUBLIC";
  const claimable = s?.kind === "CLAIMABLE_BALANCE";

  return (
    <section aria-label="Review before signing" className="send-rise rounded-2xl border border-hairline bg-surface p-5 shadow-sm">
      <header className="flex flex-wrap items-baseline justify-between gap-2">
        <div>
          <h2 className="text-base font-semibold text-ink">
            {cleanup
              ? "Remove leftover signers"
              : reclaim
                ? "Reclaim unclaimed balances"
                : review.purpose === "REAUTHORIZE"
                  ? "Send the failed rows again"
                  : "Review and approve"}
          </h2>
          <p className="mt-0.5 text-xs text-ink-muted">
            {cleanup
              ? "One signature removes the temporary signers a past distribution could not use."
              : reclaim
                ? "The claim window has closed. One signature brings every unclaimed balance back to your account."
                : "One wallet signature authorizes every transaction below. Nothing moves until you approve."}
          </p>
        </div>
        <span className={`rounded-full px-3 py-1 font-mono text-xs tabular-nums ${expired ? "bg-danger-soft text-danger" : "bg-sidebar text-ink"}`}>
          {expired ? "Window closed" : `${mins}:${secs}`}
        </span>
      </header>

      <dl className="mt-4 divide-y divide-hairline">
        {cleanup ? (
          <Row label="Signers to remove" value={review.signerCount ?? "…"} />
        ) : reclaim ? (
          <>
            <Row label="Balances to reclaim" value={review.reclaimCount ?? "…"} hint="Their reserve is released as well" />
            <Row label="Stellar transactions" value={review.transactionCount} />
          </>
        ) : (
          <>
            {s && <Row label="Recipients" value={s.recipientCount.toLocaleString("en-US")} />}
            {s && <Row label="Total" value={`${s.totalAmount} ${s.asset}`} />}
            <Row label="Stellar transactions" value={review.transactionCount} hint="Sent in parallel, each from its own channel" />
            <Row label="Network" value={mainnet ? "Mainnet" : "Testnet"} />
            {s && <Row label="Delivery" value={claimable ? "Claimable balances" : "Direct payments"} />}
            {s && claimable && s.claimExpiresAt && (
              <Row
                label="Claim until"
                value={new Date(s.claimExpiresAt).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}
                hint="Afterwards you can reclaim whatever was not claimed"
              />
            )}
            {p && claimable && (
              <Row
                label="Reserve locked"
                value={`${p.claimableReserve} XLM`}
                hint={`${p.baseReserve} XLM per claimant, returned when each balance is claimed or reclaimed`}
              />
            )}
          </>
        )}
        <Row label="Network fees and temporary signer reserve" value={<span className="text-success">Covered by Sendall</span>} />
      </dl>

      {error && (
        <p role="alert" className="mt-4 rounded-xl bg-warning-soft px-3 py-2 text-sm text-warning">
          {error.message}
        </p>
      )}

      <div className="mt-5 flex flex-wrap justify-end gap-2">
        <button
          type="button"
          onClick={onCancel}
          disabled={busy}
          className="cursor-pointer rounded-full border border-hairline px-4 py-2 text-sm font-medium text-ink transition-colors hover:bg-sidebar disabled:cursor-not-allowed disabled:opacity-50"
        >
          Cancel
        </button>
        <button
          type="button"
          onClick={onApprove}
          disabled={busy || expired}
          className="accent-gradient cursor-pointer rounded-full px-5 py-2 text-sm font-medium text-white shadow-sm transition-transform hover:scale-[1.03] disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:scale-100"
        >
          {busy ? "Waiting for wallet…" : "Approve in wallet"}
        </button>
      </div>
    </section>
  );
}

/** Everything preflight found, before anything was signed. */
export function PreflightProblems({
  error,
  rowNumberOf,
  onDismiss,
}: {
  error: RunRequestError;
  rowNumberOf: (recipientId: string) => number | undefined;
  onDismiss: () => void;
}) {
  const problems = error.problems.length > 0 ? error.problems : [{ code: error.code ?? "ERROR", message: error.message }];
  return (
    <section role="alert" aria-label="Fix before sending" className="send-rise rounded-2xl border border-danger/30 bg-danger-soft p-5">
      <header className="flex items-baseline justify-between gap-2">
        <h2 className="text-base font-semibold text-danger">Nothing was sent</h2>
        <button type="button" onClick={onDismiss} className="cursor-pointer text-xs font-medium text-danger/80 hover:text-danger">
          Dismiss
        </button>
      </header>
      <p className="mt-0.5 text-xs text-danger/80">Fix these and send again. Your wallet was not asked to sign anything.</p>
      <ul className="mt-3 flex flex-col gap-1.5">
        {problems.slice(0, 12).map((p, i) => {
          const row = p.recipientId ? rowNumberOf(p.recipientId) : undefined;
          return (
            <li key={`${p.code}-${p.recipientId ?? i}`} className="text-sm text-ink">
              {row !== undefined && <span className="mr-2 font-mono text-xs text-ink-muted">Row {row}</span>}
              {p.message}
            </li>
          );
        })}
        {problems.length > 12 && <li className="text-xs text-ink-muted">and {problems.length - 12} more, flagged in the table below</li>}
      </ul>
    </section>
  );
}
