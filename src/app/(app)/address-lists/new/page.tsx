"use client";

import { useCallback, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { useWallet } from "@/components/wallet/WalletProvider";
import { ConnectButton } from "@/components/wallet/ConnectButton";

const EXAMPLE = [
  "name,address",
  "Alice,GDM5TPUTB7A7UW4QJ5SGUVA7WVJCNOHZO5RZIYM2Y4B3MJQB3F6CGOC5",
  "GBRPYHIL2CI3FNQ4BXLFMNDLFJUNPU2HY3ZMFSHONUCEOASW7QC7OX2H",
].join("\n");

export default function NewAddressListPage() {
  const router = useRouter();
  const { address } = useWallet();
  const [name, setName] = useState("");
  const [text, setText] = useState("");
  const [fileName, setFileName] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleFilePicked = useCallback(async (file: File) => {
    setText((await file.text()).trim());
    setFileName(file.name);
  }, []);

  const handleSubmit = useCallback(async () => {
    if (!name.trim()) {
      toast.error("Give this list a name");
      return;
    }
    setBusy(true);
    try {
      const res = await fetch("/api/address-lists", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: name.trim(), text }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Failed to create list");
      router.replace(`/address-lists/${data.list.id}`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to create list");
      setBusy(false);
    }
  }, [name, text, router]);

  if (!address) {
    return (
      <div className="flex flex-col items-center gap-4 py-16 text-center">
        <p className="text-sm text-ink-muted">Connect your wallet to create an address list.</p>
        <ConnectButton />
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight text-ink">New address list</h1>
        <p className="mt-1 text-sm text-ink-muted">
          Paste rows, upload a CSV, or add addresses one at a time later.
        </p>
      </div>

      <div className="flex flex-col gap-2">
        <label className="text-sm font-medium text-ink" htmlFor="list-name">
          List name
        </label>
        <input
          id="list-name"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Vendors, Contributors, Airdrop round 3…"
          className="rounded-xl border border-hairline bg-paper px-3 py-2 text-sm text-ink outline-none focus:border-accent"
        />
      </div>

      <div className="flex flex-col gap-2">
        <div className="flex items-center justify-between">
          <label className="text-sm font-medium text-ink" htmlFor="list-text">
            Addresses
          </label>
          <div className="flex items-center gap-4 text-xs">
            <button
              type="button"
              onClick={() => setText(EXAMPLE)}
              className="cursor-pointer text-accent hover:underline"
            >
              Show example
            </button>
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              className="cursor-pointer text-accent hover:underline"
            >
              Upload CSV
            </button>
            <input
              ref={fileInputRef}
              type="file"
              accept=".csv,text/csv,text/plain"
              className="hidden"
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (file) handleFilePicked(file);
                e.target.value = "";
              }}
            />
          </div>
        </div>
        <textarea
          id="list-text"
          value={text}
          onChange={(e) => {
            setText(e.target.value);
            setFileName(null);
          }}
          rows={10}
          placeholder={"name,address\nAlice,G...\nG... (name optional)"}
          className="rounded-xl border border-hairline bg-paper px-3 py-2 font-mono text-sm text-ink outline-none focus:border-accent"
        />
        <p className="text-xs text-ink-faint">
          One per line: name,address, or just an address.
          {fileName && <span className="ml-2 text-ink-muted">Loaded from {fileName}</span>}
        </p>
      </div>

      <div className="flex gap-3">
        <button
          type="button"
          onClick={handleSubmit}
          disabled={busy}
          className="accent-gradient cursor-pointer rounded-full px-4 py-2 text-sm font-medium text-white shadow-sm transition-transform hover:scale-[1.03] disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:scale-100"
        >
          {busy ? "Creating…" : "Create list"}
        </button>
      </div>
    </div>
  );
}
