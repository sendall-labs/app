import Papa from "papaparse";
import { z } from "zod";
import type { ParsedRecipientRow } from "@/lib/stellar/validation";

export const MAX_BATCH_ROWS = 5000;

const rawRowSchema = z.object({
  destination: z.string(),
  amount: z.string(),
  memo: z.string().optional(),
});

export type CsvParseResult = {
  rows: ParsedRecipientRow[];
  errors: { rowIndex: number; message: string }[];
  truncated: boolean;
};

/**
 * Server-side authoritative parse of raw CSV text. Never trust a
 * client-parsed preview — this is what validation/checks/tx-building
 * actually run against.
 */
export function parseRecipientsCsv(csvText: string): CsvParseResult {
  const result = Papa.parse<Record<string, string>>(csvText, {
    header: true,
    skipEmptyLines: true,
    transformHeader: (h) => h.trim().toLowerCase(),
  });

  const errors: { rowIndex: number; message: string }[] = [];
  const rows: ParsedRecipientRow[] = [];

  const dataRows = result.data.slice(0, MAX_BATCH_ROWS);
  const truncated = result.data.length > MAX_BATCH_ROWS;

  dataRows.forEach((raw, index) => {
    const rowIndex = index + 1; // 1-based, matches spreadsheet row minus header
    const parsed = rawRowSchema.safeParse({
      destination: raw.destination?.trim() ?? "",
      amount: raw.amount?.trim() ?? "",
      memo: raw.memo?.trim() || undefined,
    });

    if (!parsed.success || !parsed.data.destination || !parsed.data.amount) {
      errors.push({
        rowIndex,
        message: "Missing required destination/amount column",
      });
      return;
    }

    rows.push({ rowIndex, ...parsed.data });
  });

  return { rows, errors, truncated };
}
