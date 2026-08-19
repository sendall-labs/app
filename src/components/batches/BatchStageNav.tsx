export type Stage = "prepare" | "confirm" | "send";

export const STAGES: { key: Stage; label: string }[] = [
  { key: "prepare", label: "Prepare" },
  { key: "confirm", label: "Confirm" },
  { key: "send", label: "Send" },
];

export function stageFromStatus(status: string): Stage {
  if (status === "SUBMITTING" || status === "PARTIAL_FAILURE" || status === "COMPLETED") return "send";
  if (status === "READY") return "confirm";
  return "prepare";
}

/**
 * Same stepper on both the New Batch form and an existing batch's review
 * page, so pressing "New batch" drops you straight into what looks (and
 * is styled) like the Prepare stage rather than a differently-shaped page.
 * Steps without an `onSelect` render disabled — used on New Batch, where
 * Confirm/Send don't correspond to anything yet.
 */
export function BatchStageNav({
  current,
  onSelect,
}: {
  current: Stage;
  onSelect?: (stage: Stage) => void;
}) {
  const currentIndex = STAGES.findIndex((s) => s.key === current);
  return (
    <nav className="flex gap-1 border-b border-hairline">
      {STAGES.map((stage, i) => {
        const isCurrent = i === currentIndex;
        const isDone = i < currentIndex;
        const enabled = !!onSelect;
        return (
          <button
            key={stage.key}
            type="button"
            disabled={!enabled}
            onClick={() => onSelect?.(stage.key)}
            className={`flex items-center gap-2 rounded-t-sm border-b-2 px-1 pb-3 text-sm font-medium outline-none transition-colors focus-visible:ring-2 focus-visible:ring-accent/60 ${
              enabled ? "cursor-pointer" : "cursor-default"
            } ${
              isCurrent
                ? "border-accent text-ink"
                : isDone
                  ? "border-transparent text-ink-muted hover:text-ink"
                  : `border-transparent text-ink-faint ${enabled ? "hover:text-ink-muted" : ""}`
            }`}
          >
            <span
              className={`flex h-5 w-5 items-center justify-center rounded-full text-[11px] ${
                isCurrent
                  ? "bg-accent text-accent-ink"
                  : isDone
                    ? "bg-success-soft text-success"
                    : "bg-sidebar text-ink-faint"
              }`}
            >
              {isDone ? "✓" : i + 1}
            </span>
            {stage.label}
          </button>
        );
      })}
    </nav>
  );
}
