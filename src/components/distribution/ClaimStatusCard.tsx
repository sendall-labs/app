"use client";

export type ClaimSummaryView = {
  created: number;
  unclaimed: number;
  claimed: number;
  reclaimed: number;
  expiresAt: string | null;
  syncedAt: string;
};

function timeLeft(expiresAt: string | null) {
  if (!expiresAt) return null;
  const ms = new Date(expiresAt).getTime() - Date.now();
  if (ms <= 0) return { expired: true, label: "Claim window closed" };
  const days = Math.floor(ms / 86_400_000);
  const hours = Math.floor((ms % 86_400_000) / 3_600_000);
  return { expired: false, label: days > 0 ? `${days}d ${hours}h left to claim` : `${hours}h left to claim` };
}

function Stat({ label, value, tone }: { label: string; value: number; tone: string }) {
  return (
    <div className="flex flex-col">
      <span className={`text-2xl font-semibold tabular-nums ${tone}`}>{value}</span>
      <span className="text-xs text-ink-muted">{label}</span>
    </div>
  );
}

/**
 * Where each claimable balance stands: still waiting, claimed by its
 * recipient, or taken back by the sender after the window closed.
 */
export function ClaimStatusCard({
  summary,
  syncing,
  onRefresh,
  action,
}: {
  summary: ClaimSummaryView;
  syncing: boolean;
  onRefresh: () => void;
  action?: React.ReactNode;
}) {
  const left = timeLeft(summary.expiresAt);
  const pct = summary.created > 0 ? Math.round((summary.claimed / summary.created) * 100) : 0;
  return (
    <section aria-label="Claim status" className="rounded-2xl border border-hairline bg-surface p-5 shadow-sm">
      <header className="flex flex-wrap items-baseline justify-between gap-2">
        <div>
          <h2 className="text-base font-semibold text-ink">
            Claimed {summary.claimed} of {summary.created}
          </h2>
          {left && <p className={`mt-0.5 text-xs ${left.expired ? "text-warning" : "text-ink-muted"}`}>{left.label}</p>}
        </div>
        <button
          type="button"
          onClick={onRefresh}
          disabled={syncing}
          className="cursor-pointer rounded-full border border-hairline px-3 py-1.5 text-xs font-medium text-ink hover:bg-sidebar disabled:cursor-not-allowed disabled:opacity-50"
        >
          {syncing ? "Checking…" : "Refresh"}
        </button>
      </header>
      <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-sidebar">
        <div className="h-full rounded-full bg-success transition-[width] duration-700" style={{ width: `${pct}%` }} />
      </div>
      <div className="mt-4 grid grid-cols-3 gap-4">
        <Stat label="Waiting" value={summary.unclaimed} tone="text-ink" />
        <Stat label="Claimed" value={summary.claimed} tone="text-success" />
        <Stat label="Reclaimed" value={summary.reclaimed} tone="text-warning" />
      </div>
      {action && <div className="mt-4 flex justify-end">{action}</div>}
    </section>
  );
}

const PILL: Record<string, string> = {
  UNCLAIMED: "bg-sidebar text-ink-muted",
  CLAIMED: "bg-success-soft text-success",
  RECLAIMED: "bg-warning-soft text-warning",
};
const LABEL: Record<string, string> = { UNCLAIMED: "Unclaimed", CLAIMED: "Claimed", RECLAIMED: "Reclaimed" };

export function ClaimPill({ status, href }: { status: string; href?: string | null }) {
  const pill = <span className={`rounded-full px-2 py-0.5 text-[11px] font-medium ${PILL[status] ?? ""}`}>{LABEL[status] ?? status}</span>;
  return href ? (
    <a href={href} target="_blank" rel="noopener noreferrer" className="hover:opacity-80">
      {pill}
    </a>
  ) : (
    pill
  );
}
