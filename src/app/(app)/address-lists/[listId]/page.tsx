"use client";

import { useCallback, useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { toast } from "sonner";
import { useWallet } from "@/components/wallet/WalletProvider";

type Entry = { id: string; name: string; address: string; addressValid: boolean };
type AddressList = { id: string; name: string; entries: Entry[] };

function entriesToText(entries: Entry[]): string {
  return entries.map((e) => `${e.name},${e.address}`).join("\n");
}

export default function AddressListDetailPage() {
  const { listId } = useParams<{ listId: string }>();
  const router = useRouter();
  const { network } = useWallet();
  const [list, setList] = useState<AddressList | null>(null);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState<string | null>(null);

  const load = useCallback(() => {
    fetch(`/api/address-lists/${listId}`)
      .then((res) => res.json())
      .then((data) => {
        if (data.list) setList(data.list);
      });
  }, [listId]);

  useEffect(() => {
    load();
  }, [load]);

  const startEditing = () => {
    if (list) setDraft(entriesToText(list.entries));
    setEditing(true);
  };

  const saveEdits = useCallback(async () => {
    setBusy("save");
    try {
      const res = await fetch(`/api/address-lists/${listId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text: draft }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Failed to save");
      setList(data.list);
      setEditing(false);
      toast.success("List updated");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to save");
    } finally {
      setBusy(null);
    }
  }, [listId, draft]);

  const deleteList = useCallback(async () => {
    if (!confirm("Delete this address list? This can't be undone.")) return;
    setBusy("delete");
    try {
      const res = await fetch(`/api/address-lists/${listId}`, { method: "DELETE" });
      if (!res.ok) throw new Error((await res.json()).error ?? "Failed to delete");
      router.replace("/address-lists");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to delete");
      setBusy(null);
    }
  }, [listId, router]);

  const startBatch = useCallback(async () => {
    setBusy("start-batch");
    try {
      const res = await fetch(`/api/address-lists/${listId}/start-batch`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ network }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Failed to start batch");
      router.push(`/batches/${data.batch.id}`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to start batch");
      setBusy(null);
    }
  }, [listId, network, router]);

  if (!list) return <p className="text-sm text-ink-muted">Loading…</p>;

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-ink">{list.name}</h1>
          <p className="mt-1 text-sm text-ink-muted">{list.entries.length} addresses</p>
        </div>
        <div className="flex gap-3">
          <button
            type="button"
            onClick={startBatch}
            disabled={busy !== null || list.entries.length === 0}
            className="accent-gradient cursor-pointer rounded-full px-4 py-2 text-sm font-medium text-white shadow-sm transition-transform hover:scale-[1.03] disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:scale-100"
          >
            {busy === "start-batch" ? "Starting…" : "Start batch from this list"}
          </button>
          <button
            type="button"
            onClick={deleteList}
            disabled={busy !== null}
            className="cursor-pointer rounded-full border border-hairline px-4 py-2 text-sm font-medium text-danger hover:bg-danger-soft disabled:cursor-not-allowed disabled:opacity-50"
          >
            Delete
          </button>
        </div>
      </div>

      {editing ? (
        <div className="flex flex-col gap-2">
          <textarea
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            rows={12}
            className="rounded-xl border border-hairline bg-paper px-3 py-2 font-mono text-sm text-ink outline-none focus:border-accent"
          />
          <div className="flex gap-3">
            <button
              type="button"
              onClick={saveEdits}
              disabled={busy !== null}
              className="accent-gradient cursor-pointer rounded-full px-4 py-2 text-sm font-medium text-white shadow-sm transition-transform hover:scale-[1.03] disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:scale-100"
            >
              {busy === "save" ? "Saving…" : "Save"}
            </button>
            <button
              type="button"
              onClick={() => setEditing(false)}
              className="cursor-pointer rounded-full border border-hairline px-4 py-2 text-sm font-medium text-ink transition-colors hover:bg-sidebar"
            >
              Cancel
            </button>
          </div>
        </div>
      ) : (
        <div className="rounded-2xl border border-hairline bg-surface shadow-sm">
          <div className="flex items-center justify-between border-b border-hairline px-5 py-3">
            <span className="text-xs uppercase tracking-wide text-ink-faint">Addresses</span>
            <button
              type="button"
              onClick={startEditing}
              className="cursor-pointer text-xs text-accent hover:underline"
            >
              Edit
            </button>
          </div>
          {list.entries.length === 0 ? (
            <p className="px-5 py-8 text-sm text-ink-muted">No addresses yet. Click Edit to add some.</p>
          ) : (
            <ul className="divide-y divide-hairline">
              {list.entries.map((entry) => (
                <li key={entry.id} className="flex items-center justify-between px-5 py-3">
                  <span className="font-medium text-ink">{entry.name}</span>
                  <span
                    className={`font-mono text-xs ${entry.addressValid ? "text-ink-muted" : "text-danger"}`}
                  >
                    {entry.address}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}
