"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useWallet } from "@/components/wallet/WalletProvider";
import { ConnectButton } from "@/components/wallet/ConnectButton";

const NAV_ITEMS = [
  { href: "/home", label: "Home" },
  { href: "/batches/new", label: "New batch" },
  { href: "/batches", label: "Batches" },
  { href: "/address-lists", label: "Address Lists" },
  { href: "/check-balance", label: "Check Balance" },
  { href: "/demo", label: "Demo" },
];

function truncate(address: string): string {
  return `${address.slice(0, 4)}…${address.slice(-4)}`;
}

export function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const { network, address } = useWallet();

  const isActive = (href: string) =>
    href === "/batches"
      ? pathname === "/batches" || /^\/batches\/(?!new$)/.test(pathname)
      : pathname.startsWith(href);

  return (
    <div className="flex min-h-screen flex-col md:flex-row">
      {/* Desktop sidebar */}
      <aside className="hidden w-60 shrink-0 flex-col border-r border-hairline bg-sidebar px-4 py-5 md:flex">
        <Link href="/home" className="px-2 py-1.5 font-serif text-lg font-semibold">
          Sendall
        </Link>

        <nav className="mt-8 flex flex-col gap-0.5">
          {NAV_ITEMS.map((item) => (
            <Link
              key={item.href}
              href={item.href}
              className={`rounded-md px-3 py-2 text-sm font-medium transition-colors ${
                isActive(item.href)
                  ? "bg-surface text-ink shadow-sm"
                  : "text-ink-muted hover:bg-surface/70 hover:text-ink"
              }`}
            >
              {item.label}
            </Link>
          ))}
        </nav>

        <div className="mt-auto flex flex-col gap-3 border-t border-hairline pt-4">
          <div className="flex items-center gap-2 px-2 text-xs text-ink-muted">
            <span className="h-1.5 w-1.5 rounded-full bg-accent" />
            {network === "PUBLIC" ? "Public Network" : "Testnet"}
          </div>
          {address && (
            <div className="flex items-center gap-2 px-2 py-1">
              <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-accent text-[10px] font-medium text-accent-ink">
                {address.slice(1, 3)}
              </span>
              <span className="truncate font-mono text-xs text-ink-muted">{truncate(address)}</span>
            </div>
          )}
        </div>
      </aside>

      {/* Mobile top bar */}
      <div className="flex items-center justify-between border-b border-hairline px-4 py-3 md:hidden">
        <Link href="/home" className="font-serif text-lg font-semibold">
          Sendall
        </Link>
        <ConnectButton />
      </div>
      <nav className="flex gap-1 overflow-x-auto border-b border-hairline px-4 py-2 md:hidden">
        {NAV_ITEMS.map((item) => (
          <Link
            key={item.href}
            href={item.href}
            className={`shrink-0 rounded-md px-3 py-1.5 text-sm font-medium ${
              isActive(item.href) ? "bg-sidebar text-ink" : "text-ink-muted"
            }`}
          >
            {item.label}
          </Link>
        ))}
      </nav>

      <div className="flex flex-1 flex-col">
        <header className="hidden items-center justify-end border-b border-hairline px-8 py-4 md:flex">
          <ConnectButton />
        </header>
        <main className="flex-1 px-4 py-6 md:px-8 md:py-10">
          <div className="mx-auto w-full max-w-5xl">{children}</div>
        </main>
      </div>
    </div>
  );
}
