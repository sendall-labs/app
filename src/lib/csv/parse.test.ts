import { describe, it, expect } from "vitest";
import { parseRecipientsCsv } from "./parse";

const G = "GAGSCFEPY3DVJJZ6XPSA3N2NGCXGTNFLFNIDUQOIBPHTT2XRJR4F2YP7";

describe("parseRecipientsCsv", () => {
  it("parses valid rows with header", () => {
    const csv = `destination,amount,memo\n${G},10.5,hello\n`;
    const result = parseRecipientsCsv(csv);
    expect(result.rows).toHaveLength(1);
    expect(result.rows[0]).toMatchObject({
      destination: G,
      amount: "10.5",
      memo: "hello",
    });
    expect(result.errors).toHaveLength(0);
  });

  it("treats memo as optional", () => {
    const csv = `destination,amount\n${G},10\n`;
    const result = parseRecipientsCsv(csv);
    expect(result.rows).toHaveLength(1);
    expect(result.rows[0].memo).toBeUndefined();
  });

  it("is case-insensitive and trims header names", () => {
    const csv = `Destination, Amount \n${G},10\n`;
    const result = parseRecipientsCsv(csv);
    expect(result.rows).toHaveLength(1);
  });

  it("flags rows missing destination or amount as errors, not silent drops", () => {
    const csv = `destination,amount\n,10\n${G},\n`;
    const result = parseRecipientsCsv(csv);
    expect(result.rows).toHaveLength(0);
    expect(result.errors).toHaveLength(2);
    expect(result.errors[0].rowIndex).toBe(1);
    expect(result.errors[1].rowIndex).toBe(2);
  });

  it("skips empty lines", () => {
    const csv = `destination,amount\n${G},10\n\n${G},20\n`;
    const result = parseRecipientsCsv(csv);
    expect(result.rows).toHaveLength(2);
  });

  it("assigns 1-based rowIndex matching CSV row order", () => {
    const csv = `destination,amount\n${G},1\n${G},2\n${G},3\n`;
    const result = parseRecipientsCsv(csv);
    expect(result.rows.map((r) => r.rowIndex)).toEqual([1, 2, 3]);
  });
});
