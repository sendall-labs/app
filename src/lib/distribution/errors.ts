// Every refusal the channel engine can return before or during a run.
// Codes are stable strings so the API and UI can branch on them.
export type DistributionErrorCode =
  | "ACCOUNT_NOT_FOUND"
  | "INSUFFICIENT_SIGNER_SLOTS"
  | "UNSUPPORTED_MULTISIG"
  | "INSUFFICIENT_CHANNELS"
  | "CHANNEL_SEQUENCE_CHANGED"
  | "SETUP_MISMATCH"
  | "SETUP_EXPIRED"
  | "SPONSOR_NOT_CONFIGURED"
  | "SPONSOR_UNDERFUNDED"
  | "PREFLIGHT_FAILED"
  | "INVALID_STATE";

export class DistributionError extends Error {
  constructor(
    readonly code: DistributionErrorCode,
    message: string,
    readonly details?: Record<string, unknown>
  ) {
    super(message);
    this.name = "DistributionError";
  }
}
