"use client";

import { useCallback, useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";

// Two testnet addresses funded and reused throughout this project's own
// dev/testing — real accounts on real testnet, not placeholders.
const SAMPLE_RECIPIENTS = [
  "GASLYAGARN5G4FS76IF3W5E54ZYB5HNSYY4P6SBC742RDZLL2NY7JA7B,1",
  "GBQ5UP2HBURSCIUOAM3CKTDKLORXB5QMELLBJ3YRXXAJ3IFMV5C72FOF,1",
].join("\n");

const STEPS = [
  { n: "01", title: "Create a batch", body: "No wallet needed — this happens anonymously." },
  { n: "02", title: "Recipients are pre-filled", body: "Two funded testnet addresses, ready to validate." },
  { n: "03", title: "Validate", body: "Address, trustline, and balance checks run automatically." },
  { n: "04", title: "Sign & send", body: "Connect your wallet here — this is a real testnet transaction." },
];

export default function DemoPage() {
  const router = useRouter();
  const [busy, setBusy] = useState(false);

  const startDemo = useCallback(async () => {
    setBusy(true);
    try {
      const res = await fetch("/api/batches", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          csvText: `destination,amount,memo\n${SAMPLE_RECIPIENTS}`,
          network: "TESTNET",
          csvFileName: "Sendall demo",
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Failed to start the demo");
      router.push(`/batches/${data.batch.id}?demo=1`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to start the demo");
      setBusy(false);
    }
  }, [router]);

  return (
    <div className="flex flex-col gap-8">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight text-ink">Demo</h1>
        <p className="mt-1 text-sm text-ink-muted">
          A guided walkthrough of the full batch flow — on real testnet, not a simulation.
        </p>
      </div>

      <ol className="grid gap-px overflow-hidden rounded-2xl border border-hairline bg-hairline sm:grid-cols-2 lg:grid-cols-4">
        {STEPS.map((step) => (
          <li key={step.n} className="bg-surface px-5 py-6">
            <span className="font-mono text-xs text-ink-faint">{step.n}</span>
            <h2 className="mt-2 text-sm font-semibold text-ink">{step.title}</h2>
            <p className="mt-1 text-xs text-ink-muted">{step.body}</p>
          </li>
        ))}
      </ol>

      <div>
        <button
          type="button"
          onClick={startDemo}
          disabled={busy}
          className="accent-gradient cursor-pointer rounded-full px-6 py-3 text-sm font-medium text-white shadow-sm transition-transform hover:scale-[1.03] disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:scale-100"
        >
          {busy ? "Starting…" : "Start the demo"}
        </button>
        <p className="mt-2 text-xs text-ink-faint">
          Creates a real batch on testnet. No wallet needed until you sign.
        </p>
      </div>
    </div>
  );
}
