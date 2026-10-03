import { describe, expect, it } from "vitest";
import { Keypair } from "@stellar/stellar-sdk";
import type { ReceiptData } from "./receiptData";
import { renderReceipt } from "./render";

function data(rows: number): ReceiptData {
  return {
    number: "SND-TEST0001",
    batchId: "b",
    title: "Grant round payouts.csv",
    sender: Keypair.random().publicKey(),
    network: "TESTNET",
    asset: { code: "USDC", issuer: Keypair.random().publicKey() },
    kind: "CLAIMABLE_BALANCE",
    date: new Date("2026-10-03T00:00:00Z"),
    claimDeadline: new Date("2026-11-02T00:00:00Z"),
    recipientCount: rows,
    deliveredCount: rows - 1,
    deliveredAmount: String((rows - 1) * 10),
    failedCount: 1,
    transactionCount: Math.ceil(rows / 100),
    authorizationTxs: ["ab".repeat(32)],
    rows: Array.from({ length: rows }, (_, i) => ({
      index: i + 1,
      address: Keypair.random().publicKey(),
      amount: "10",
      method: "Claimable balance" as const,
      status: i === 0 ? "Not delivered" : "Set aside, unclaimed",
      delivered: i !== 0,
      txHash: i === 0 ? null : "cd".repeat(32),
    })),
  };
}

// Count page objects in the raw PDF ("/Type /Page" but not "/Pages").
const pageCount = (pdf: Buffer) => (pdf.toString("latin1").match(/\/Type\s*\/Page(?!s)/g) ?? []).length;

describe("receipt PDF", () => {
  it("renders 1,000 rows as a valid multipage PDF", async () => {
    const pdf = await renderReceipt(data(1000));
    expect(pdf.subarray(0, 5).toString()).toBe("%PDF-");
    expect(pdf.subarray(-8).toString()).toContain("%%EOF");
    expect(pageCount(pdf)).toBeGreaterThan(20);
  }, 60_000);

  it("keeps a small receipt on one page", async () => {
    expect(pageCount(await renderReceipt(data(5)))).toBe(1);
  });
});
