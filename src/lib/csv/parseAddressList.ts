import Papa from "papaparse";
import { isValidDestination } from "@/lib/stellar/validation";

export const MAX_ADDRESS_LIST_ROWS = 5000;

export type ParsedAddressRow = {
  rowIndex: number;
  name: string;
  address: string;
  addressValid: boolean;
};

export type AddressListParseResult = {
  rows: ParsedAddressRow[];
  errors: { rowIndex: number; message: string }[];
  truncated: boolean;
};

function truncateAddress(address: string): string {
  return address.length > 8 ? `${address.slice(0, 4)}…${address.slice(-4)}` : address;
}

/**
 * Accepts a CSV with name,address columns, or freeform pasted text — one
 * entry per line, either "name,address" or a bare address (name defaults
 * to a truncated form of the address). Parsed with PapaParse either way so
 * a quoted name containing a comma still works.
 */
export function parseAddressList(text: string): AddressListParseResult {
  const result = Papa.parse<string[]>(text, { skipEmptyLines: true });
  const errors: { rowIndex: number; message: string }[] = [];
  const rows: ParsedAddressRow[] = [];

  const dataRows = result.data.slice(0, MAX_ADDRESS_LIST_ROWS);
  const truncated = result.data.length > MAX_ADDRESS_LIST_ROWS;

  dataRows.forEach((fields, index) => {
    const rowIndex = index + 1;
    const first = fields[0]?.trim() ?? "";
    const second = fields[1]?.trim() ?? "";
    if (!first) return;

    // A literal "name,address" header — skip it rather than importing it
    // as a bogus entry.
    if (index === 0 && first.toLowerCase() === "name" && second.toLowerCase() === "address") return;

    const hasName = Boolean(second);
    const address = hasName ? second : first;
    const name = hasName ? first : truncateAddress(first);

    if (!address) {
      errors.push({ rowIndex, message: "Missing address" });
      return;
    }

    rows.push({ rowIndex, name, address, addressValid: isValidDestination(address) });
  });

  return { rows, errors, truncated };
}

export const ADDRESS_LIST_HEADER = "name,address";
