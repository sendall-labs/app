import Link from "next/link";
import { ConnectButton } from "@/components/wallet/ConnectButton";

export default function Home() {
  return (
    <div className="flex flex-1 flex-col">
      <header className="flex items-center justify-between border-b border-neutral-200 px-6 py-4 dark:border-neutral-800">
        <span className="text-lg font-semibold">MultiSend</span>
        <ConnectButton />
      </header>

      <main className="mx-auto flex w-full max-w-2xl flex-1 flex-col items-center justify-center gap-6 px-6 text-center">
        <h1 className="text-3xl font-bold">Bulk Stellar payments, without the backend</h1>
        <p className="text-neutral-600 dark:text-neutral-400">
          Upload a recipient list, validate addresses and trustlines, sign with your
          wallet, and send XLM or Stellar assets to many recipients in one workflow.
        </p>
        <Link
          href="/batches/new"
          className="rounded-md bg-neutral-900 px-6 py-3 text-sm font-medium text-white hover:bg-neutral-700 dark:bg-white dark:text-neutral-900"
        >
          Start a batch
        </Link>
        <p className="text-xs text-neutral-500">
          Connect your wallet first — batches are scoped to your signed-in address.
        </p>
      </main>
    </div>
  );
}
