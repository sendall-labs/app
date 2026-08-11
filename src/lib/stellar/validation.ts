import { StrKey } from "@stellar/stellar-sdk";

export const MAX_AMOUNT_DECIMALS = 7;
// i64 max stroops (Stellar's largest representable amount): 922337203685.4775807 XLM/units
export const MAX_AMOUNT = 922337203685.4775807;

export type ParsedRecipientRow = {
  rowIndex: number;
  destination: string;
  amount: string;
  memo?: string;
};

export type ValidatedRecipient = ParsedRecipientRow & {
  addressValid: boolean;
  amountValid: boolean;
  isDuplicate: boolean;
  errorMessage?: string;
};

export function isValidDestination(destination: string): boolean {
  return (
    StrKey.isValidEd25519PublicKey(destination) ||
    StrKey.isValidMed25519PublicKey(destination)
  );
}

export function isValidAmount(rawAmount: string): boolean {
  if (!/^\d+(\.\d+)?$/.test(rawAmount.trim())) return false;
  const value = Number(rawAmount);
  if (!Number.isFinite(value) || value <= 0) return false;
  if (value > MAX_AMOUNT) return false;
  const decimals = rawAmount.trim().split(".")[1];
  if (decimals && decimals.length > MAX_AMOUNT_DECIMALS) return false;
  return true;
}

export function validateRecipients(
  rows: ParsedRecipientRow[]
): ValidatedRecipient[] {
  const seen = new Map<string, number>();
  for (const row of rows) {
    const key = `${row.destination}|${row.memo ?? ""}`;
    seen.set(key, (seen.get(key) ?? 0) + 1);
  }

  return rows.map((row) => {
    const addressValid = isValidDestination(row.destination.trim());
    const amountValid = isValidAmount(row.amount);
    const key = `${row.destination}|${row.memo ?? ""}`;
    const isDuplicate = (seen.get(key) ?? 0) > 1;

    let errorMessage: string | undefined;
    if (!addressValid) errorMessage = "Invalid Stellar address";
    else if (!amountValid)
      errorMessage = `Invalid amount (must be positive, max ${MAX_AMOUNT_DECIMALS} decimals)`;

    return {
      ...row,
      destination: row.destination.trim(),
      addressValid,
      amountValid,
      isDuplicate,
      errorMessage,
    };
  });
}
