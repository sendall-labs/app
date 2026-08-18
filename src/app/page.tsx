import Link from "next/link";
import { ConnectButton } from "@/components/wallet/ConnectButton";

export default function Home() {
  return (
    <div className="flex flex-1 flex-col">
      <header className="flex items-center justify-between border-b border-hairline px-6 py-4">
        <span className="font-serif text-lg font-semibold">Sendall</span>
        <ConnectButton />
      </header>

      <main className="mx-auto flex w-full max-w-2xl flex-1 flex-col items-center justify-center gap-6 px-6 text-center">
        <h1 className="font-serif text-4xl font-semibold text-ink">
          Bulk Stellar payments, without the backend
        </h1>
        <p className="text-ink-muted">
          Upload a recipient list, validate addresses and trustlines, sign with your
          wallet, and send XLM or Stellar assets to many recipients in one workflow.
        </p>
        <Link
          href="/batches/new"
          className="rounded-md bg-accent px-6 py-3 text-sm font-medium text-accent-ink hover:bg-accent-hover"
        >
          Start a batch
        </Link>
        <p className="text-xs text-ink-faint">
          Connect your wallet first — batches are scoped to your signed-in address.
        </p>
      </main>
    </div>
  );
}
