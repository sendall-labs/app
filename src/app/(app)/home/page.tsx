export default function HomePage() {
  return (
    <div className="flex flex-col gap-8">
      <div>
        <h1 className="font-serif text-2xl font-semibold text-ink">Home</h1>
        <p className="mt-1 text-sm text-ink-muted">
          Your wallet balances and recent batches, at a glance.
        </p>
      </div>
      <div className="rounded-lg border border-hairline bg-surface px-5 py-8 text-sm text-ink-muted">
        Coming soon — wallet balances and a recent-batches summary will land here.
      </div>
    </div>
  );
}
