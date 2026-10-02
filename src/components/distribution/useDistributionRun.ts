"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { RunView } from "@/lib/distribution/batchRuns";

export type RunPhase = "idle" | "preparing" | "awaiting-signature" | "authorizing" | "running" | "done" | "error";

export type PreparedSummary = {
  recipientCount: number;
  totalAmount: string;
  asset: string;
  network: string;
  kind: string;
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

/**
 * Client side of the channel engine: prepare, one wallet signature,
 * authorize, then follow the run until it ends. Polling also drives the
 * engine on the server, so keeping this page open keeps the run moving.
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
  const [summary, setSummary] = useState<PreparedSummary | null>(null);
  const [transactionCount, setTransactionCount] = useState(0);
  const [error, setError] = useState<RunRequestError | null>(null);
  const runIdRef = useRef<string | null>(null);
  const finishedRef = useRef(onFinished);
  const errorRef = useRef(onError);
  useEffect(() => {
    finishedRef.current = onFinished;
    errorRef.current = onError;
  }, [onFinished, onError]);

  const signAndAuthorize = useCallback(
    async (runId: string, setupXdr: string) => {
      setPhase("awaiting-signature");
      let signed: string;
      try {
        signed = await signTransaction(setupXdr);
      } catch {
        throw new RunRequestError("The wallet did not approve. Nothing was sent.", "WALLET_REJECTED");
      }
      setPhase("authorizing");
      const { run: view } = await postJson(`/api/runs/${runId}/authorize`, { signedXdr: signed });
      setRun(view);
      setPhase("running");
    },
    [signTransaction]
  );

  const fail = useCallback((err: unknown) => {
    const error = err instanceof RunRequestError ? err : new RunRequestError(err instanceof Error ? err.message : "Send failed");
    setError(error);
    setPhase("error");
    errorRef.current?.(error);
  }, []);

  /** Starts (or resumes) a run for the batch's ready rows. */
  const start = useCallback(
    async (batchId: string) => {
      setError(null);
      setPhase("preparing");
      try {
        await ensureClaimed();
        let prepared: { runId: string; setupXdr: string; transactionCount: number; summary: PreparedSummary };
        try {
          prepared = await postJson(`/api/batches/${batchId}/runs`, { idempotencyKey: crypto.randomUUID() });
        } catch (err) {
          // A run is already waiting for this batch (e.g. after a reload):
          // pick it up instead of starting another.
          if (err instanceof RunRequestError && err.code === "INVALID_STATE" && err.runId) {
            const { run: existing } = await (await fetch(`/api/runs/${err.runId}`)).json();
            runIdRef.current = existing.id;
            setRun(existing);
            if (existing.status === "AWAITING_USER_SIGNATURE" && existing.setupXdr) {
              await signAndAuthorize(existing.id, existing.setupXdr);
            } else {
              setPhase("running");
            }
            return;
          }
          throw err;
        }
        runIdRef.current = prepared.runId;
        setSummary(prepared.summary);
        setTransactionCount(prepared.transactionCount);
        await signAndAuthorize(prepared.runId, prepared.setupXdr);
      } catch (err) {
        fail(err);
      }
    },
    [ensureClaimed, signAndAuthorize, fail]
  );

  /** New authorization for the rows a finished run could not deliver. */
  const reauthorize = useCallback(
    async (previousRunId: string) => {
      setError(null);
      setPhase("preparing");
      try {
        await ensureClaimed();
        const next = await postJson(`/api/runs/${previousRunId}/reauthorize`, { idempotencyKey: crypto.randomUUID() });
        runIdRef.current = next.runId;
        setTransactionCount(next.transactionCount);
        await signAndAuthorize(next.runId, next.setupXdr);
      } catch (err) {
        fail(err);
      }
    },
    [ensureClaimed, signAndAuthorize, fail]
  );

  /** Removes signers a run left behind (one extra signature, rare). */
  const cleanup = useCallback(
    async (runId: string) => {
      setError(null);
      try {
        await ensureClaimed();
        const plan = await postJson(`/api/runs/${runId}/cleanup`, {});
        if (plan.clean) return true;
        runIdRef.current = plan.cleanupRunId;
        await signAndAuthorize(plan.cleanupRunId, plan.setupXdr);
        return true;
      } catch (err) {
        fail(err);
        return false;
      }
    },
    [ensureClaimed, signAndAuthorize, fail]
  );

  /** Follow an existing run, e.g. one already in flight when the page opened. */
  const watch = useCallback((runId: string) => {
    runIdRef.current = runId;
    setPhase("running");
  }, []);

  useEffect(() => {
    if (phase !== "running") return;
    let stopped = false;
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
    let timer = setTimeout(tick, 0);
    return () => {
      stopped = true;
      clearTimeout(timer);
    };
  }, [phase]);

  const reset = useCallback(() => {
    setPhase("idle");
    setError(null);
  }, []);

  return { phase, run, summary, transactionCount, error, start, reauthorize, cleanup, watch, reset };
}
