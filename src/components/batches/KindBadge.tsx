export function KindBadge({ kind }: { kind: "PAYMENT" | "CLAIMABLE_BALANCE" }) {
  return kind === "CLAIMABLE_BALANCE" ? (
    <span className="rounded-full bg-accent-2/10 px-2.5 py-1 text-xs font-medium text-accent-2">Claimable</span>
  ) : (
    <span className="rounded-full bg-accent/10 px-2.5 py-1 text-xs font-medium text-accent">Payment</span>
  );
}
