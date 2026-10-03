// Client-safe: shared by the API and the batch page.
export const CLAIM_WINDOW_OPTIONS = [7, 30, 90] as const;
export type ClaimWindowDays = (typeof CLAIM_WINDOW_OPTIONS)[number];
export const DEFAULT_CLAIM_WINDOW_DAYS: ClaimWindowDays = 30;

const DAY_MS = 86_400_000;

/** When recipients stop being able to claim (and the sender can reclaim), counted from `from`. */
export function claimDeadline(days: number, from = new Date()): Date {
  return new Date(from.getTime() + days * DAY_MS);
}
