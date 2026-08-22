"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useWallet } from "@/components/wallet/WalletProvider";
import { ConnectButton } from "@/components/wallet/ConnectButton";

// Minimal 20px outline icons, drawn inline (no icon package) to match the
// rest of the app's zero-dependency footprint.
function IconHome(props: React.SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" {...props}>
      <path d="M3 8.5 10 3l7 5.5" />
      <path d="M4.75 7.5V16a1 1 0 0 0 1 1h8.5a1 1 0 0 0 1-1V7.5" />
    </svg>
  );
}

function IconPlusCircle(props: React.SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" {...props}>
      <circle cx="10" cy="10" r="7" />
      <path d="M10 7v6M7 10h6" />
    </svg>
  );
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

function IconBook(props: React.SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" {...props}>
      <path d="M4 4.5A1.5 1.5 0 0 1 5.5 3H16v13.5H5.5A1.5 1.5 0 0 0 4 18Z" />
      <path d="M4 4.5v12A1.5 1.5 0 0 0 5.5 18H16" />
    </svg>
  );
}

function IconWallet(props: React.SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" {...props}>
      <rect x="3" y="5.5" width="14" height="10" rx="2" />
      <path d="M3 8.5h14" />
      <path d="M13 12h2" />
    </svg>
  );
}

function IconSparkle(props: React.SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" {...props}>
      <path d="M10 3v3M10 14v3M3 10h3M14 10h3M5.5 5.5l2 2M12.5 12.5l2 2M14.5 5.5l-2 2M7.5 12.5l-2 2" />
    </svg>
  );
}

const NAV_ITEMS = [
  { href: "/home", label: "Home", icon: IconHome },
  { href: "/batches/new", label: "New batch", icon: IconPlusCircle },
  { href: "/batches", label: "Batches", icon: IconStack },
  { href: "/address-lists", label: "Address Lists", icon: IconBook },
  { href: "/check-balance", label: "Check Balance", icon: IconWallet },
  { href: "/demo", label: "Demo", icon: IconSparkle },
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
        <Link href="/home" className="flex items-center gap-2.5 px-2 py-1.5">
          <span className="accent-gradient flex h-7 w-7 shrink-0 items-center justify-center rounded-lg text-xs font-bold text-white">
            S
          </span>
          <span className="text-lg font-bold tracking-tight">Sendall</span>
        </Link>

        <nav className="mt-8 flex flex-col gap-0.5">
          {NAV_ITEMS.map((item) => (
            <Link
              key={item.href}
              href={item.href}
              className={`flex items-center gap-2.5 rounded-full px-3 py-2 text-sm font-medium transition-colors ${
                isActive(item.href)
                  ? "bg-accent/10 text-accent"
                  : "text-ink-muted hover:bg-surface/70 hover:text-ink"
              }`}
            >
              <item.icon className="h-[18px] w-[18px] shrink-0" />
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
        <Link href="/home" className="flex items-center gap-2">
          <span className="accent-gradient flex h-6 w-6 shrink-0 items-center justify-center rounded-md text-[11px] font-bold text-white">
            S
          </span>
          <span className="text-lg font-bold tracking-tight">Sendall</span>
        </Link>
        <ConnectButton />
      </div>
      <nav className="flex gap-1 overflow-x-auto border-b border-hairline px-4 py-2 md:hidden">
        {NAV_ITEMS.map((item) => (
          <Link
            key={item.href}
            href={item.href}
            className={`flex shrink-0 items-center gap-1.5 rounded-full px-3 py-1.5 text-sm font-medium transition-colors ${
              isActive(item.href) ? "bg-accent/10 text-accent" : "text-ink-muted"
            }`}
          >
            <item.icon className="h-4 w-4 shrink-0" />
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
