"use client";

type Kind = "PAYMENT" | "CLAIMABLE_BALANCE";

const OPTIONS: { value: Kind; label: string; hint: string }[] = [
  { value: "PAYMENT", label: "Payment", hint: "Arrives right away. Recipients need the account and trustline today." },
  {
    value: "CLAIMABLE_BALANCE",
    label: "Claimable balance",
    hint: "Set aside on-chain. Recipients claim after adding a trustline; you can reclaim after expiry.",
  },
];

/**
 * Send the same list as payments or as claimable balances. The sender
 * chooses for the whole batch; switching re-runs the checks for the new
 * type. Locked once anything has been signed.
 */
export function KindSwitch({ value, disabled, onChange }: { value: Kind; disabled: boolean; onChange: (next: Kind) => void }) {
  const active = OPTIONS.find((o) => o.value === value)!;
  return (
    <div className="flex flex-col gap-1.5">
      <div role="radiogroup" aria-label="Send as" className="inline-flex w-fit rounded-full border border-hairline bg-sidebar p-1">
        {OPTIONS.map((o) => (
          <button
            key={o.value}
            type="button"
            role="radio"
            aria-checked={o.value === value}
            disabled={disabled}
            onClick={() => o.value !== value && onChange(o.value)}
            className={`cursor-pointer rounded-full px-4 py-1.5 text-sm font-medium transition-colors disabled:cursor-not-allowed ${
              o.value === value ? "bg-surface text-ink shadow-sm" : "text-ink-muted hover:text-ink disabled:hover:text-ink-muted"
            }`}
          >
            {o.label}
          </button>
        ))}
      </div>
      <p className="text-xs text-ink-faint">{active.hint}</p>
    </div>
  );
}
