"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { RunView } from "@/lib/distribution/batchRuns";

// idle -> preparing -> review -> awaiting-signature -> authorizing -> running -> done
// A wallet rejection goes back to review; anything that stops the flow
// before signing ends in "error".
export type RunPhase = "idle" | "preparing" | "review" | "awaiting-signature" | "authorizing" | "running" | "done" | "error";

export type PreparedSummary = {
  recipientCount: number;
  totalAmount: string;
  asset: string;
  network: string;
  kind: string;
  claimExpiresAt?: string | null;
};

export type PreflightInfo = {
  baseReserve: string;
  senderNativeNeeded: string;
  senderAssetNeeded: string | null;
  claimableReserve: string;
  sponsorNeeded: string;
};

export type ReviewInfo = {
  runId: string;
  setupXdr: string;
  purpose: "SEND" | "REAUTHORIZE" | "CLEANUP" | "RECLAIM";
  transactionCount: number;
  summary: PreparedSummary | null;
  preflight: PreflightInfo | null;
  signerCount?: number; // cleanup only
  reclaimCount?: number; // reclaim only
  expiresAt: number;
};

export type RunProblem = { code: string; message: string; recipientId?: string };

export class RunRequestError extends Error {
  constructor(
    message: string,
    readonly code?: string,
    readonly problems: RunProblem[] = [],
    readonly runId?: string
  ) {
    super(message);
  }
}

async function postJson(url: string, body: unknown) {
  const res = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new RunRequestError(data.error ?? "Request failed", data.code, data.details?.problems ?? [], data.details?.runId);
  }
  return data;
}

const POLL_MS = 1000;
const SETUP_WINDOW_MS = 5 * 60 * 1000;

/**
 * Client side of the channel engine: prepare and review, one wallet
 * signature, authorize, then follow the run until it ends. Polling also
 * drives the engine on the server, so keeping this page open keeps the
 * run moving.
 */
export function useDistributionRun(params: {
  signTransaction: (xdr: string) => Promise<string>;
  ensureClaimed: () => Promise<void>;
  onFinished?: (run: RunView) => void;
  onError?: (error: RunRequestError) => void;
}) {
  const { signTransaction, ensureClaimed, onFinished, onError } = params;
  const [phase, setPhase] = useState<RunPhase>("idle");
  const [run, setRun] = useState<RunView | null>(null);
  const [review, setReview] = useState<ReviewInfo | null>(null);
  const [error, setError] = useState<RunRequestError | null>(null);
  const runIdRef = useRef<string | null>(null);
  const finishedRef = useRef(onFinished);
  const errorRef = useRef(onError);
  useEffect(() => {
    finishedRef.current = onFinished;
    errorRef.current = onError;
  }, [onFinished, onError]);

  const fail = useCallback((err: unknown) => {
    const e = err instanceof RunRequestError ? err : new RunRequestError(err instanceof Error ? err.message : "Send failed");
    setError(e);
    setPhase("error");
    errorRef.current?.(e);
  }, []);

  const toReview = useCallback((info: ReviewInfo) => {
    runIdRef.current = info.runId;
    setReview(info);
    setRun(null);
    setError(null);
    setPhase("review");
  }, []);

  /** Prepares a run for the batch's ready rows and stops at the review step. */
  const prepare = useCallback(
    async (batchId: string) => {
      setError(null);
      setPhase("preparing");
      try {
        await ensureClaimed();
        try {
          const p = await postJson(`/api/batches/${batchId}/runs`, { idempotencyKey: crypto.randomUUID() });
          toReview({
            runId: p.runId,
            setupXdr: p.setupXdr,
            purpose: "SEND",
            transactionCount: p.transactionCount,
            summary: p.summary,
            preflight: p.preflight,
            expiresAt: Date.now() + SETUP_WINDOW_MS,
          });
        } catch (err) {
          // A run for this batch is already waiting or in flight (e.g. after
          // a reload): pick it up instead of starting another.
          if (err instanceof RunRequestError && err.code === "INVALID_STATE" && err.runId) {
            const { run: existing } = (await (await fetch(`/api/runs/${err.runId}`)).json()) as { run: RunView & { setupXdr: string | null } };
            if (existing.status === "AWAITING_USER_SIGNATURE" && existing.setupXdr) {
              toReview({
                runId: existing.id,
                setupXdr: existing.setupXdr,
                purpose: existing.purpose === "REAUTHORIZE" ? "REAUTHORIZE" : "SEND",
                transactionCount: existing.transactions.length,
                summary: null,
                preflight: null,
                expiresAt: existing.setup.expiresAt ? new Date(existing.setup.expiresAt).getTime() : Date.now() + SETUP_WINDOW_MS,
              });
            } else {
              runIdRef.current = existing.id;
              setRun(existing);
              setPhase("running");
            }
            return;
          }
          throw err;
        }
      } catch (err) {
        fail(err);
      }
    },
    [ensureClaimed, toReview, fail]
  );

  /** The one wallet signature. A rejection returns to the review step. */
  const approve = useCallback(async () => {
    if (!review) return;
    setError(null);
    setPhase("awaiting-signature");
    let signed: string;
    try {
      signed = await signTransaction(review.setupXdr);
    } catch {
      const e = new RunRequestError("The wallet did not approve. Nothing was sent; you can approve again or cancel.", "WALLET_REJECTED");
      setError(e);
      setPhase("review");
      return;
    }
    try {
      setPhase("authorizing");
      const { run: view } = await postJson(`/api/runs/${review.runId}/authorize`, { signedXdr: signed });
      setRun(view);
      setPhase("running");
    } catch (err) {
      fail(err);
    }
  }, [review, signTransaction, fail]);

  /** Backs out at the review step; the rows become ready again. */
  const cancel = useCallback(async () => {
    const r = review;
    setReview(null);
    setError(null);
    setPhase("idle");
    if (r && r.purpose !== "CLEANUP") {
      // Send and reclaim runs hold channels; free them now.
      await fetch(`/api/runs/${r.runId}/cancel`, { method: "POST" }).catch(() => {});
    }
  }, [review]);

  /** New authorization for the rows a finished run could not deliver. */
  const reauthorize = useCallback(
    async (previousRunId: string) => {
      setError(null);
      setPhase("preparing");
      try {
        await ensureClaimed();
        const next = await postJson(`/api/runs/${previousRunId}/reauthorize`, { idempotencyKey: crypto.randomUUID() });
        toReview({
          runId: next.runId,
          setupXdr: next.setupXdr,
          purpose: "REAUTHORIZE",
          transactionCount: next.transactionCount,
          summary: null,
          preflight: null,
          expiresAt: Date.now() + SETUP_WINDOW_MS,
        });
      } catch (err) {
        fail(err);
      }
    },
    [ensureClaimed, toReview, fail]
  );

  /** Takes back every expired, unclaimed claimable balance of the batch. */
  const reclaim = useCallback(
    async (batchId: string) => {
      setError(null);
      setPhase("preparing");
      try {
        await ensureClaimed();
        const p = await postJson(`/api/batches/${batchId}/reclaim`, { idempotencyKey: crypto.randomUUID() });
        toReview({
          runId: p.runId,
          setupXdr: p.setupXdr,
          purpose: "RECLAIM",
          transactionCount: p.transactionCount,
          summary: null,
          preflight: null,
          reclaimCount: p.count,
          expiresAt: Date.now() + SETUP_WINDOW_MS,
        });
      } catch (err) {
        fail(err);
      }
    },
    [ensureClaimed, toReview, fail]
  );

  /** Removes signers a run left behind (one extra signature, rare). */
  const cleanup = useCallback(
    async (runId: string) => {
      setError(null);
      setPhase("preparing");
      try {
        await ensureClaimed();
        const plan = await postJson(`/api/runs/${runId}/cleanup`, {});
        if (plan.clean) {
          setPhase("idle");
          return;
        }
        toReview({
          runId: plan.cleanupRunId,
          setupXdr: plan.setupXdr,
          purpose: "CLEANUP",
          transactionCount: 0,
          summary: null,
          preflight: null,
          signerCount: plan.signerCount,
          expiresAt: Date.now() + SETUP_WINDOW_MS,
        });
      } catch (err) {
        fail(err);
      }
    },
    [ensureClaimed, toReview, fail]
  );

  /** Follow an existing run, e.g. one already in flight when the page opened. */
  const watch = useCallback((runId: string) => {
    runIdRef.current = runId;
    setPhase("running");
  }, []);

  useEffect(() => {
    if (phase !== "running") return;
    let stopped = false;
    let timer: ReturnType<typeof setTimeout>;
    const tick = async () => {
      const id = runIdRef.current;
      if (!id || stopped) return;
      try {
        const res = await fetch(`/api/runs/${id}`);
        if (res.ok) {
          const { run: view } = (await res.json()) as { run: RunView };
          if (stopped) return;
          setRun(view);
          if (view.terminal) {
            setPhase("done");
            finishedRef.current?.(view);
            return;
          }
        }
      } catch {
        // transient; next tick retries
      }
      if (!stopped) timer = setTimeout(tick, POLL_MS);
    };
    timer = setTimeout(tick, 0);
    return () => {
      stopped = true;
      clearTimeout(timer);
    };
  }, [phase]);

  const reset = useCallback(() => {
    setPhase("idle");
    setError(null);
    setReview(null);
    setRun(null);
  }, []);

  return {
    phase,
    run,
    review,
    transactionCount: review?.transactionCount ?? run?.transactions.length ?? 0,
    error,
    prepare,
    approve,
    cancel,
    reauthorize,
    reclaim,
    cleanup,
    watch,
    reset,
  };
}
