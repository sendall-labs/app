import Link from "next/link";
import { ConnectButton } from "@/components/wallet/ConnectButton";

const RECIPIENTS = ["GDQP…4RXK", "GCLM…9F2H", "GA7X…K03P", "GB2N…WQ81", "GDF6…L9M4"];

const STEPS = [
  {
    n: "01",
    title: "Upload",
    body: "Paste or import a CSV of destination, amount rows. No wallet needed yet.",
  },
  {
    n: "02",
    title: "Validate",
    body: "Every address, trustline, and balance is checked before anything is signed.",
  },
  {
    n: "03",
    title: "Sign & send",
    body: "One signature authorizes the whole batch — even past 100 operations.",
  },
];

function BatchDiagram() {
  return (
    <div className="rounded-xl border border-hairline bg-surface p-6 sm:p-8">
      <div className="flex flex-col gap-6 lg:flex-row lg:items-center">
        <div className="flex flex-col gap-2">
          {RECIPIENTS.map((address, i) => (
            <span
              key={address}
              style={{ marginLeft: `${i * 8}px` }}
              className="w-fit whitespace-nowrap rounded-full border border-hairline bg-paper px-3 py-1 font-mono text-xs text-ink-muted"
            >
              {address}
            </span>
          ))}
        </div>

        <div className="h-px w-full shrink-0 lg:h-px lg:w-auto lg:flex-1">
          <div className="batch-flow-line h-px w-full" />
        </div>

        <div className="shrink-0 rounded-lg border border-hairline bg-paper px-4 py-3">
          <div className="flex items-center gap-2 text-success">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
              <path d="M20 6 9 17l-5-5" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
            <span className="text-sm font-medium text-ink">Ledger closed</span>
          </div>
          <p className="mt-1 font-mono text-xs text-ink-faint">#58,210,437 · 247 payments · 4.98s</p>
        </div>
      </div>
    </div>
  );
}

export default function LandingPage() {
  return (
    <div className="flex flex-1 flex-col">
      <header className="flex items-center justify-between border-b border-hairline px-6 py-4">
        <span className="font-serif text-lg font-semibold">Sendall</span>
        <ConnectButton />
      </header>

      <main className="mx-auto flex w-full max-w-6xl flex-1 flex-col gap-24 px-6 py-16 sm:py-20">
        <section className="grid items-center gap-16 lg:grid-cols-[1.05fr_1fr]">
          <div>
            <p className="font-mono text-xs uppercase tracking-[0.2em] text-accent">
              Stellar · Bulk payments
            </p>
            <h1 className="mt-5 font-serif text-5xl leading-[1.05] font-semibold text-ink sm:text-6xl">
              Pay hundreds of wallets. One signature.
            </h1>
            <p className="mt-6 max-w-md text-base text-ink-muted">
              Upload a recipient list — Sendall validates every address and trustline,
              you sign once, and it chains the rest into a single ledger close.
            </p>
            <div className="mt-8 flex flex-wrap items-center gap-4">
              <Link
                href="/batches/new"
                className="rounded-md bg-accent px-6 py-3 text-sm font-medium text-accent-ink hover:bg-accent-hover"
              >
                Start a batch
              </Link>
              <span className="text-xs text-ink-faint">
                No wallet needed until you&apos;re ready to send.
              </span>
            </div>
          </div>

          <BatchDiagram />
        </section>

        <section>
          <ol className="grid gap-px overflow-hidden rounded-xl border border-hairline bg-hairline sm:grid-cols-3">
            {STEPS.map((step) => (
              <li key={step.n} className="bg-surface px-6 py-8">
                <span className="font-mono text-xs text-ink-faint">{step.n}</span>
                <h2 className="mt-2 font-serif text-lg font-semibold text-ink">{step.title}</h2>
                <p className="mt-2 text-sm text-ink-muted">{step.body}</p>
              </li>
            ))}
          </ol>
        </section>

        <p className="text-center text-xs text-ink-faint">
          Testnet and public network · native XLM or any issued asset · works around
          Stellar&apos;s 100-operation-per-transaction limit automatically.
        </p>
      </main>
    </div>
  );
}
