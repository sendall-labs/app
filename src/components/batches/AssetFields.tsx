"use client";

import { useEffect, useRef, useState } from "react";
import { KNOWN_ASSETS, findKnownAsset, issuerForNetwork, type KnownAsset } from "@/lib/stellar/assets";

const cardFieldClass =
  "w-full rounded-xl border border-hairline bg-paper px-2 py-1 text-sm text-ink placeholder:text-ink-faint focus:border-accent focus:outline-none";

export function NetworkField({
  network,
  assetCode,
  assetIssuer,
  patchNetworkAsset,
}: {
  network: string;
  assetCode: string | null;
  assetIssuer: string | null;
  patchNetworkAsset: (next: { network: string; assetCode: string; assetIssuer: string }) => void;
}) {
  return (
    <div className="flex flex-col justify-center rounded-2xl border border-hairline bg-surface shadow-sm px-5 py-4">
      <label className="text-xs uppercase tracking-wide text-ink-faint">Network</label>
      <select
        value={network}
        onChange={(e) => {
          const nextNetwork = e.target.value;
          // A known asset's issuer differs by network — re-resolve it for
          // whichever network is being switched to instead of carrying the
          // old (now wrong) one over. A custom/unrecognized issuer is left
          // exactly as the user entered it.
          const known = assetCode ? findKnownAsset(assetCode) : undefined;
          const nextIssuer = known ? (issuerForNetwork(known, nextNetwork) ?? "") : (assetIssuer ?? "");
          patchNetworkAsset({ network: nextNetwork, assetCode: assetCode ?? "", assetIssuer: nextIssuer });
        }}
        className={`${cardFieldClass} mt-1.5`}
      >
        <option value="TESTNET">Testnet</option>
        <option value="PUBLIC">Public (Mainnet)</option>
      </select>
    </div>
  );
}

export function AssetIcon({ code, accentClass, icon }: { code: string; accentClass: string; icon?: string | null }) {
  if (icon) {
    // Small fixed local file (public/assets/tokens) — not worth next/image's pipeline.
    // eslint-disable-next-line @next/next/no-img-element
    return <img src={icon} alt={code} className="h-8 w-8 shrink-0 rounded-full" />;
  }
  return (
    <span
      className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-xs font-semibold ${accentClass}`}
    >
      {code.slice(0, 1)}
    </span>
  );
}

export function AssetField({
  network,
  assetCode,
  assetIssuer,
  patchNetworkAsset,
}: {
  network: string;
  assetCode: string | null;
  assetIssuer: string | null;
  patchNetworkAsset: (next: { network: string; assetCode: string; assetIssuer: string }) => void;
}) {
  // Blank defaults to native XLM — shown as "XLM" outright rather than an
  // empty box the user has to already know means the same thing.
  const currentCode = assetCode ?? "XLM";
  const known = findKnownAsset(currentCode);
  const [mode, setMode] = useState<"search" | "custom">(currentCode !== "XLM" && !known ? "custom" : "search");
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [resolvedIcon, setResolvedIcon] = useState<{ code: string; issuer: string; image: string | null; name: string | null } | null>(null);
  const rootRef = useRef<HTMLDivElement>(null);

  // Custom assets don't ship a local icon — look one up the way a wallet
  // actually should (SEP-1: home_domain -> stellar.toml -> CURRENCIES
  // .image) instead of showing a bare monogram forever.
  useEffect(() => {
    if (known || !assetCode || !assetIssuer || !/^G[A-Z2-7]{55}$/.test(assetIssuer)) return;
    let cancelled = false;
    const code = assetCode;
    const issuer = assetIssuer;
    fetch(`/api/assets/icon?network=${network}&code=${encodeURIComponent(code)}&issuer=${issuer}`)
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => {
        if (!cancelled && data) setResolvedIcon({ code, issuer, ...data });
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [known, assetCode, assetIssuer, network]);

  const customIcon =
    resolvedIcon && resolvedIcon.code === assetCode && resolvedIcon.issuer === assetIssuer ? resolvedIcon : null;

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (e: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) setOpen(false);
    };
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("mousedown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [open]);

  const visibleAssets = KNOWN_ASSETS.filter((a) => a.issuer === null || issuerForNetwork(a, network));
  const filtered = visibleAssets.filter((a) => {
    const q = query.trim().toLowerCase();
    if (!q) return true;
    return a.code.toLowerCase().includes(q) || a.domain.toLowerCase().includes(q);
  });

  const selectAsset = (asset: KnownAsset) => {
    patchNetworkAsset({
      network,
      assetCode: asset.code === "XLM" ? "" : asset.code,
      assetIssuer: issuerForNetwork(asset, network) ?? "",
    });
    setOpen(false);
    setQuery("");
  };

  if (mode === "custom") {
    return (
      <div className="rounded-2xl border border-hairline bg-surface shadow-sm px-5 py-4">
        <div className="flex items-center justify-between">
          <label className="text-xs uppercase tracking-wide text-ink-faint">Asset</label>
          <button
            type="button"
            onClick={() => setMode("search")}
            className="cursor-pointer text-xs font-medium text-accent hover:underline"
          >
            Browse known assets
          </button>
        </div>
        {assetCode && (
          <div className="mt-2 flex items-center gap-2 text-xs text-ink-faint">
            <AssetIcon code={assetCode} accentClass="bg-sidebar text-ink-muted" icon={customIcon?.image} />
            {customIcon?.name ?? "Looked up automatically from the issuer's stellar.toml"}
          </div>
        )}
        <div key={`${assetCode}-${assetIssuer}`} className="mt-2 flex flex-col gap-1.5">
          <input
            defaultValue={currentCode === "XLM" ? "" : currentCode}
            onBlur={(e) => {
              const code = e.target.value.trim().toUpperCase();
              if (!code || code === "XLM") {
                if (assetCode) patchNetworkAsset({ network, assetCode: "", assetIssuer: "" });
                setMode("search");
                return;
              }
              const match = findKnownAsset(code);
              if (match?.issuer) {
                patchNetworkAsset({ network, assetCode: code, assetIssuer: issuerForNetwork(match, network) ?? "" });
                setMode("search");
              } else if (code !== currentCode) {
                patchNetworkAsset({ network, assetCode: code, assetIssuer: "" });
              }
            }}
            placeholder="Asset code"
            className={cardFieldClass}
          />
          <input
            defaultValue={assetIssuer ?? ""}
            onBlur={(e) => {
              const issuer = e.target.value.trim();
              if (issuer !== (assetIssuer ?? "")) {
                patchNetworkAsset({ network, assetCode: currentCode, assetIssuer: issuer });
              }
            }}
            placeholder="Issuer G..."
            className={`${cardFieldClass} font-mono text-xs`}
          />
        </div>
      </div>
    );
  }

  return (
    <div ref={rootRef} className="relative rounded-2xl border border-hairline bg-surface shadow-sm px-5 py-4">
      <label className="text-xs uppercase tracking-wide text-ink-faint">Asset</label>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="mt-2 flex w-full cursor-pointer items-center gap-3 rounded-xl border border-hairline bg-paper px-3 py-2 text-left hover:border-accent"
      >
        <AssetIcon
          code={currentCode}
          accentClass={known?.accentClass ?? "bg-sidebar text-ink-muted"}
          icon={known?.icon}
        />
        <span className="min-w-0 flex-1">
          <span className="block text-sm font-medium text-ink">{currentCode}</span>
          <span className="block truncate text-xs text-ink-faint">{known?.domain ?? "Custom asset"}</span>
        </span>
        <svg
          viewBox="0 0 20 20"
          className={`h-4 w-4 shrink-0 text-ink-faint transition-transform ${open ? "rotate-180" : ""}`}
          fill="none"
          stroke="currentColor"
          strokeWidth="1.6"
        >
          <path d="M5 7.5 10 12.5 15 7.5" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </button>

      {open && (
        <div className="absolute left-0 top-full z-20 mt-1 w-full rounded-xl border border-hairline bg-surface shadow-lg">
          <div className="flex items-center gap-2 border-b border-hairline px-3 py-2">
            <svg viewBox="0 0 20 20" className="h-4 w-4 shrink-0 text-ink-faint" fill="none" stroke="currentColor" strokeWidth="1.6">
              <circle cx="9" cy="9" r="6" />
              <path d="m17 17-4-4" strokeLinecap="round" />
            </svg>
            <input
              autoFocus
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Type asset name or code"
              className="flex-1 bg-transparent text-sm text-ink placeholder:text-ink-faint focus:outline-none"
            />
            {query && (
              <button
                type="button"
                onClick={() => setQuery("")}
                className="cursor-pointer text-ink-faint hover:text-ink"
              >
                ×
              </button>
            )}
          </div>
          <p className="px-3 pt-2 text-[11px] font-medium uppercase tracking-wide text-ink-faint">Known assets</p>
          <div className="max-h-64 overflow-y-auto py-1">
            {filtered.map((a) => (
              <button
                key={a.code}
                type="button"
                onClick={() => selectAsset(a)}
                className="flex w-full cursor-pointer items-center gap-3 px-3 py-2 text-left transition-colors hover:bg-sidebar"
              >
                <AssetIcon code={a.code} accentClass={a.accentClass} icon={a.icon} />
                <span className="min-w-0 flex-1">
                  <span className="block text-sm font-medium text-ink">{a.code}</span>
                  <span className="block truncate text-xs text-ink-faint">{a.domain}</span>
                </span>
              </button>
            ))}
            {filtered.length === 0 && (
              <p className="px-3 py-4 text-center text-xs text-ink-faint">No known assets match &ldquo;{query}&rdquo;.</p>
            )}
          </div>
          <button
            type="button"
            onClick={() => {
              setOpen(false);
              setMode("custom");
            }}
            className="block w-full cursor-pointer border-t border-hairline px-3 py-2 text-left text-xs font-medium text-accent hover:underline"
          >
            + Enter a custom asset
          </button>
        </div>
      )}
    </div>
  );
}
