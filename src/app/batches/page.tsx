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

export default function BatchesPage() {
  const [batches, setBatches] = useState<BatchSummary[] | null>(null);

  useEffect(() => {
    fetch("/api/batches")
      .then((res) => res.json())
      .then((data) => setBatches(data.batches ?? []));
  }, []);

  return (
    <div className="mx-auto flex w-full max-w-4xl flex-col gap-6 px-6 py-12">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">Your batches</h1>
        <Link
          href="/batches/new"
          className="rounded-md bg-neutral-900 px-4 py-2 text-sm font-medium text-white hover:bg-neutral-700 dark:bg-white dark:text-neutral-900"
        >
          New batch
        </Link>
      </div>

      {!batches ? (
        <p className="text-sm text-neutral-500">Loading…</p>
      ) : batches.length === 0 ? (
        <p className="text-sm text-neutral-500">No batches yet.</p>
      ) : (
        <ul className="flex flex-col divide-y divide-neutral-200 rounded-md border border-neutral-200 dark:divide-neutral-800 dark:border-neutral-800">
          {batches.map((b) => (
            <li key={b.id}>
              <Link href={`/batches/${b.id}`} className="flex items-center justify-between px-4 py-3 text-sm hover:bg-neutral-50 dark:hover:bg-neutral-900">
                <span>{b.csvFileName ?? b.id}</span>
                <span className="text-neutral-500">
                  {b._count.recipients} recipients · {b.assetCode ?? "XLM"} · {b.network} · {b.status}
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
