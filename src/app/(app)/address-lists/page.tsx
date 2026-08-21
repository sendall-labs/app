export default function AddressListsPage() {
  return (
    <div className="flex flex-col gap-8">
      <div>
        <h1 className="font-serif text-2xl font-semibold text-ink">Address Lists</h1>
        <p className="mt-1 text-sm text-ink-muted">
          Save name + address pairs to start batches from later.
        </p>
      </div>
      <div className="rounded-lg border border-hairline bg-surface px-5 py-8 text-sm text-ink-muted">
        Coming soon — import a list via CSV or pasted text, then start a batch from it.
      </div>
    </div>
  );
}
