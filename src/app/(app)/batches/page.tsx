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

function IconStack(props: React.SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" {...props}>
      <path d="M10 3l7 3.5L10 10 3 6.5 10 3Z" />
      <path d="M3 10.5 10 14l7-3.5" />
      <path d="M3 14 10 17.5 17 14" />
    </svg>
  );
}

function IconClock(props: React.SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" {...props}>
      <circle cx="10" cy="10" r="7" />
      <path d="M10 6v4l3 2" />
    </svg>
  );
}

function IconCheck(props: React.SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" {...props}>
      <circle cx="10" cy="10" r="7" />
      <path d="M7 10.2l2 2 4-4.4" />
    </svg>
  );
}

function IconAlert(props: React.SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" {...props}>
      <path d="M10 3.5 17.5 16h-15L10 3.5Z" />
      <path d="M10 8.25v3.25M10 14h.01" />
    </svg>
  );
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
          <h1 className="text-2xl font-semibold tracking-tight text-ink">Batches</h1>
          <p className="mt-1 text-sm text-ink-muted">
            Every recipient list you&apos;ve uploaded, from validation to sent.
          </p>
        </div>
        <Link
          href="/batches/new"
          className="accent-gradient rounded-full px-4 py-2 text-sm font-medium text-white shadow-sm transition-transform hover:scale-[1.03]"
        >
          New batch
        </Link>
      </div>

      {stats && (
        <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
          <StatCard icon={IconStack} label="Total batches" value={stats.total} tone="accent" />
          <StatCard icon={IconClock} label="In progress" value={stats.inProgress} tone="warning" />
          <StatCard icon={IconCheck} label="Completed" value={stats.completed} tone="success" />
          <StatCard
            icon={IconAlert}
            label="Needs attention"
            value={stats.needsAttention}
            tone={stats.needsAttention > 0 ? "danger" : "neutral"}
          />
        </div>
      )}

      <div className="rounded-2xl border border-hairline bg-surface shadow-sm">
        {!batches ? (
          <p className="px-5 py-8 text-sm text-ink-muted">Loading…</p>
        ) : batches.length === 0 ? (
          <p className="px-5 py-8 text-sm text-ink-muted">
            No batches yet. Upload a recipient list to get started.
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
                <tr key={b.id} className="group border-b border-hairline last:border-0">
                  <td className="px-5 py-3 transition-colors group-hover:bg-sidebar/60">
                    <Link href={`/batches/${b.id}`} className="font-medium text-ink hover:text-accent">
                      {b.csvFileName ?? b.id}
                    </Link>
                  </td>
                  <td className="px-5 py-3 tabular-nums text-ink-muted transition-colors group-hover:bg-sidebar/60">
                    {b._count.recipients}
                  </td>
                  <td className="px-5 py-3 text-ink-muted transition-colors group-hover:bg-sidebar/60">
                    {b.assetCode ?? "XLM"}
                  </td>
                  <td className="px-5 py-3 text-ink-muted transition-colors group-hover:bg-sidebar/60">
                    {b.network}
                  </td>
                  <td className="px-5 py-3 transition-colors group-hover:bg-sidebar/60">
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

const STAT_TONE: Record<string, string> = {
  accent: "bg-accent/10 text-accent",
  warning: "bg-warning-soft text-warning",
  success: "bg-success-soft text-success",
  danger: "bg-danger-soft text-danger",
  neutral: "bg-sidebar text-ink-faint",
};

function StatCard({
  icon: Icon,
  label,
  value,
  tone,
}: {
  icon: (props: React.SVGProps<SVGSVGElement>) => React.ReactNode;
  label: string;
  value: number;
  tone: "accent" | "warning" | "success" | "danger" | "neutral";
}) {
  return (
    <div className="rounded-2xl border border-hairline bg-surface shadow-sm px-5 py-4 transition-shadow hover:shadow-md">
      <span className={`flex h-8 w-8 items-center justify-center rounded-full ${STAT_TONE[tone]}`}>
        <Icon className="h-4 w-4" />
      </span>
      <p className="mt-3 text-xs uppercase tracking-wide text-ink-faint">{label}</p>
      <p
        className={`mt-1 text-3xl font-bold tracking-tight tabular-nums ${
          tone === "danger" ? "text-danger" : "text-ink"
        }`}
      >
        {value}
      </p>
    </div>
  );
}
