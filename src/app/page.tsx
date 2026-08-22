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
    <div className="rounded-2xl border border-hairline bg-surface p-6 shadow-sm sm:p-8">
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

        <div className="shrink-0 rounded-2xl border border-hairline bg-paper px-4 py-3">
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
    <div className="flex flex-1 flex-col overflow-x-clip">
      <header className="flex items-center justify-between border-b border-hairline px-6 py-4">
        <span className="flex items-center gap-2.5">
          <span className="accent-gradient flex h-7 w-7 shrink-0 items-center justify-center rounded-lg text-xs font-bold text-white">
            S
          </span>
          <span className="text-lg font-bold tracking-tight">Sendall</span>
        </span>
        <ConnectButton />
      </header>

      <main className="relative mx-auto flex w-full max-w-6xl flex-1 flex-col gap-24 px-6 py-16 sm:py-20">
        {/* Ambient signature glow — the one place this page spends its
            visual boldness. Fixed to the hero, faded via mask so it never
            competes with body copy below. */}
        <div
          aria-hidden
          className="pointer-events-none absolute -top-32 left-1/2 -z-10 h-[640px] w-[900px] -translate-x-1/2 opacity-[0.16] blur-[110px]"
          style={{
            backgroundImage:
              "radial-gradient(closest-side, var(--color-accent), transparent), radial-gradient(closest-side, var(--color-accent-2), transparent)",
            backgroundPosition: "30% 30%, 70% 60%",
            backgroundSize: "60% 60%, 55% 55%",
            backgroundRepeat: "no-repeat",
          }}
        />

        <section className="grid items-center gap-16 lg:grid-cols-[1.05fr_1fr]">
          <div>
            <p className="font-mono text-xs uppercase tracking-[0.2em] text-accent">
              Stellar · Bulk payments
            </p>
            <h1 className="mt-5 text-5xl leading-[1.05] font-bold tracking-tight text-ink sm:text-6xl">
              Pay hundreds of wallets.
              <br />
              <span className="gradient-text">One signature.</span>
            </h1>
            <p className="mt-6 max-w-md text-base text-ink-muted">
              Upload a recipient list — Sendall validates every address and trustline,
              you sign once, and it chains the rest into a single ledger close.
            </p>
            <div className="mt-8 flex flex-wrap items-center gap-4">
              <Link
                href="/batches/new"
                className="accent-gradient rounded-full px-6 py-3 text-sm font-medium text-white shadow-sm transition-transform hover:scale-[1.03] hover:shadow-md"
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
          <ol className="grid gap-px overflow-hidden rounded-2xl border border-hairline bg-hairline sm:grid-cols-3">
            {STEPS.map((step) => (
              <li
                key={step.n}
                className="group relative bg-surface px-6 py-8 transition-transform duration-200 hover:z-10 hover:-translate-y-1 hover:shadow-lg"
              >
                <span className="font-mono text-xs text-ink-faint">{step.n}</span>
                <h2 className="mt-2 text-lg font-semibold text-ink">{step.title}</h2>
                <p className="mt-2 text-sm text-ink-muted">{step.body}</p>
                <span className="accent-gradient absolute inset-x-0 bottom-0 h-0.5 origin-left scale-x-0 transition-transform duration-200 group-hover:scale-x-100" />
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
