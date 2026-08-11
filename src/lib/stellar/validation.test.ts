import { describe, it, expect } from "vitest";
import {
  isValidDestination,
  isValidAmount,
  validateRecipients,
  MAX_AMOUNT,
} from "./validation";

const VALID_G_ADDRESS = "GAGSCFEPY3DVJJZ6XPSA3N2NGCXGTNFLFNIDUQOIBPHTT2XRJR4F2YP7";
const VALID_M_ADDRESS = "MAGSCFEPY3DVJJZ6XPSA3N2NGCXGTNFLFNIDUQOIBPHTT2XRJR4F2AAAAAAAAAAAAHJE2";

describe("isValidDestination", () => {
  it("accepts a valid Ed25519 G... address", () => {
    expect(isValidDestination(VALID_G_ADDRESS)).toBe(true);
  });

  it("accepts a valid muxed M... address", () => {
    expect(isValidDestination(VALID_M_ADDRESS)).toBe(true);
  });

  it("rejects a malformed address", () => {
    expect(isValidDestination("not-an-address")).toBe(false);
  });

  it("rejects a truncated G address", () => {
    expect(isValidDestination(VALID_G_ADDRESS.slice(0, -1))).toBe(false);
  });

  it("rejects an empty string", () => {
    expect(isValidDestination("")).toBe(false);
  });
});

describe("isValidAmount", () => {
  it("accepts a plain positive integer", () => {
    expect(isValidAmount("100")).toBe(true);
  });

  it("accepts up to 7 decimal places", () => {
    expect(isValidAmount("1.1234567")).toBe(true);
  });

  it("rejects more than 7 decimal places", () => {
    expect(isValidAmount("1.12345678")).toBe(false);
  });

  it("rejects zero", () => {
    expect(isValidAmount("0")).toBe(false);
  });

  it("rejects negative amounts", () => {
    expect(isValidAmount("-5")).toBe(false);
  });

  it("rejects non-numeric input", () => {
    expect(isValidAmount("abc")).toBe(false);
  });

  it("accepts the maximum representable amount", () => {
    expect(isValidAmount(String(MAX_AMOUNT))).toBe(true);
  });

  it("rejects amounts beyond the i64 max", () => {
    expect(isValidAmount("922337203686")).toBe(false);
  });
});

describe("validateRecipients", () => {
  it("flags duplicates by destination+memo without dropping them", () => {
    const rows = [
      { rowIndex: 1, destination: VALID_G_ADDRESS, amount: "10" },
      { rowIndex: 2, destination: VALID_G_ADDRESS, amount: "20" },
    ];
    const result = validateRecipients(rows);
    expect(result).toHaveLength(2);
    expect(result[0].isDuplicate).toBe(true);
    expect(result[1].isDuplicate).toBe(true);
  });

  it("does not flag same destination with different memo as duplicate", () => {
    const rows = [
      { rowIndex: 1, destination: VALID_G_ADDRESS, amount: "10", memo: "a" },
      { rowIndex: 2, destination: VALID_G_ADDRESS, amount: "20", memo: "b" },
    ];
    const result = validateRecipients(rows);
    expect(result[0].isDuplicate).toBe(false);
    expect(result[1].isDuplicate).toBe(false);
  });

  it("attaches an error message for invalid rows", () => {
    const rows = [{ rowIndex: 1, destination: "bad", amount: "10" }];
    const result = validateRecipients(rows);
    expect(result[0].addressValid).toBe(false);
    expect(result[0].errorMessage).toMatch(/Invalid Stellar address/);
  });

  it("trims whitespace from destination", () => {
    const rows = [
      { rowIndex: 1, destination: `  ${VALID_G_ADDRESS}  `, amount: "10" },
    ];
    const result = validateRecipients(rows);
    expect(result[0].destination).toBe(VALID_G_ADDRESS);
    expect(result[0].addressValid).toBe(true);
  });
});
