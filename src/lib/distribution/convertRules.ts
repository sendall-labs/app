// Shared by the server (conversion) and the batch page (the button), so
// it must not import anything server-only.

// What a claimable balance actually fixes: the recipient has no account
// or no trustline yet. An unauthorized trustline is not one of them; the
// recipient could not claim either.
const CONVERTIBLE_CODES = new Set(["paymentNoTrust", "paymentNoDestination"]);
export const MOVED_NOTE = "Moved to a claimable balance batch.";

type Row = { status: string; hasTrustline: boolean | null; accountExists: boolean | null; errorMessage?: string | null; lastResultCode?: string | null };

/** Rows of a payment batch that failed only because the recipient is not set up to receive yet. */
export function isConvertible(row: Row, nativeAsset: boolean): boolean {
  if (row.status !== "FAILED" && row.status !== "CHECK_FAILED") return false;
  if (row.errorMessage === MOVED_NOTE) return false; // already sent on as a claimable balance
  if (row.lastResultCode && CONVERTIBLE_CODES.has(row.lastResultCode)) return true;
  if (nativeAsset) return false; // XLM to a missing account is sent as account creation instead
  return row.accountExists === false || row.hasTrustline === false;
}
