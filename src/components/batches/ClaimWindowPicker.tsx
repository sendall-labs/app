"use client";

import { CLAIM_WINDOW_OPTIONS, claimDeadline } from "@/lib/distribution/claimWindow";

function formatDate(d: Date) {
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

/**
 * How long recipients have to claim. Counted from the moment the batch is
 * sent; after that the sender can take back whatever was not claimed.
 */
export function ClaimWindowPicker({ value, disabled, onChange }: { value: number; disabled: boolean; onChange: (days: number) => void }) {
  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex flex-wrap items-center gap-3">
        <span className="text-xs uppercase tracking-wide text-ink-faint">Claim window</span>
        <div role="radiogroup" aria-label="Claim window" className="inline-flex rounded-full border border-hairline bg-sidebar p-1">
          {CLAIM_WINDOW_OPTIONS.map((days) => (
            <button
              key={days}
              type="button"
              role="radio"
              aria-checked={days === value}
              disabled={disabled}
              onClick={() => days !== value && onChange(days)}
              className={`cursor-pointer rounded-full px-3 py-1 text-sm font-medium transition-colors disabled:cursor-not-allowed ${
                days === value ? "bg-surface text-ink shadow-sm" : "text-ink-muted hover:text-ink"
              }`}
            >
              {days} days
            </button>
          ))}
        </div>
      </div>
      <p className="text-xs text-ink-faint">
        Sent today, recipients can claim until {formatDate(claimDeadline(value))}. After that you can reclaim what is left.
      </p>
    </div>
  );
}
