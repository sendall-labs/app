"use client";

import { useEffect, useState } from "react";
import Link from "next/link";

type BatchSummary = {
  id: string;
  status: string;
  network: string;
  assetCode: string | null;
  createdAt: string;
  csvFileName: string | null;
  _count: { recipients: number };
};

const IN_PROGRESS = new Set([
  "DRAFT",
  "VALIDATING",
  "VALIDATED",
  "CHECKING",
  "READY",
  "SUBMITTING",
]);
const NEEDS_ATTENTION = new Set(["FAILED", "PARTIAL_FAILURE"]);

const STATUS_STYLE: Record<string, string> = {
  COMPLETED: "bg-success-soft text-success",
  FAILED: "bg-danger-soft text-danger",
  PARTIAL_FAILURE: "bg-danger-soft text-danger",
};

function statusPillClass(status: string): string {
  return STATUS_STYLE[status] ?? "bg-warning-soft text-warning";
}

export default function BatchesPage() {
  const [batches, setBatches] = useState<BatchSummary[] | null>(null);

  useEffect(() => {
    fetch("/api/batches")
      .then((res) => res.json())
      .then((data) => setBatches(data.batches ?? []));
  }, []);

  const stats = batches
    ? {
        total: batches.length,
        inProgress: batches.filter((b) => IN_PROGRESS.has(b.status)).length,
        completed: batches.filter((b) => b.status === "COMPLETED").length,
        needsAttention: batches.filter((b) => NEEDS_ATTENTION.has(b.status)).length,
      }
    : null;

  return (
    <div className="flex flex-col gap-8">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="font-serif text-2xl font-semibold text-ink">Batches</h1>
          <p className="mt-1 text-sm text-ink-muted">
            Every recipient list you&apos;ve uploaded, from validation to sent.
          </p>
        </div>
        <Link
          href="/batches/new"
          className="rounded-md bg-accent px-4 py-2 text-sm font-medium text-accent-ink hover:bg-accent-hover"
        >
          New batch
        </Link>
      </div>

      {stats && (
        <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
          <StatCard label="Total batches" value={stats.total} />
          <StatCard label="In progress" value={stats.inProgress} />
          <StatCard label="Completed" value={stats.completed} />
          <StatCard label="Needs attention" value={stats.needsAttention} tone={stats.needsAttention > 0 ? "danger" : undefined} />
        </div>
      )}

      <div className="rounded-lg border border-hairline bg-surface">
        {!batches ? (
          <p className="px-5 py-8 text-sm text-ink-muted">Loading…</p>
        ) : batches.length === 0 ? (
          <p className="px-5 py-8 text-sm text-ink-muted">
            No batches yet — upload a recipient list to get started.
          </p>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-hairline text-left text-xs uppercase tracking-wide text-ink-faint">
                <th className="px-5 py-3 font-medium">File</th>
                <th className="px-5 py-3 font-medium">Recipients</th>
                <th className="px-5 py-3 font-medium">Asset</th>
                <th className="px-5 py-3 font-medium">Network</th>
                <th className="px-5 py-3 font-medium">Status</th>
              </tr>
            </thead>
            <tbody>
              {batches.map((b) => (
                <tr key={b.id} className="border-b border-hairline last:border-0">
                  <td className="px-5 py-3">
                    <Link href={`/batches/${b.id}`} className="font-medium text-ink hover:text-accent">
                      {b.csvFileName ?? b.id}
                    </Link>
                  </td>
                  <td className="px-5 py-3 tabular-nums text-ink-muted">{b._count.recipients}</td>
                  <td className="px-5 py-3 text-ink-muted">{b.assetCode ?? "XLM"}</td>
                  <td className="px-5 py-3 text-ink-muted">{b.network}</td>
                  <td className="px-5 py-3">
                    <span
                      className={`rounded-full px-2.5 py-1 text-xs font-medium ${statusPillClass(b.status)}`}
                    >
                      {b.status}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}

function StatCard({
  label,
  value,
  tone,
}: {
  label: string;
  value: number;
  tone?: "danger";
}) {
  return (
    <div className="rounded-lg border border-hairline bg-surface px-5 py-4">
      <p className="text-xs uppercase tracking-wide text-ink-faint">{label}</p>
      <p
        className={`mt-1 font-serif text-3xl font-semibold tabular-nums ${
          tone === "danger" && value > 0 ? "text-danger" : "text-ink"
        }`}
      >
        {value}
      </p>
    </div>
  );
}
