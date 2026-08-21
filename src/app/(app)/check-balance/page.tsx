export default function CheckBalancePage() {
  return (
    <div className="flex flex-col gap-8">
      <div>
        <h1 className="font-serif text-2xl font-semibold text-ink">Check Balance</h1>
        <p className="mt-1 text-sm text-ink-muted">
          Bulk-check whether addresses exist, hold a trustline, and their balance.
        </p>
      </div>
      <div className="rounded-lg border border-hairline bg-surface px-5 py-8 text-sm text-ink-muted">
        Coming soon — paste or upload a list of addresses to check them all at once.
      </div>
    </div>
  );
}
