import { describe, expect, it } from "vitest";
import { claimableBalanceReserve, fromStroops, toStroops } from "./reserve";

describe("stroop math", () => {
  it.each([
    ["1", BigInt(10_000_000)],
    ["0.0000001", BigInt(1)],
    ["12.3456789", BigInt(123_456_789)],
    ["922337203685.4775807", BigInt("9223372036854775807")],
  ])("%s", (amount, stroops) => {
    expect(toStroops(amount)).toBe(stroops);
    expect(toStroops(fromStroops(stroops))).toBe(stroops);
  });

  it("formats without trailing zeros", () => {
    expect(fromStroops(BigInt(15_000_000))).toBe("1.5");
    expect(fromStroops(BigInt(0))).toBe("0");
    expect(fromStroops(BigInt(-5_000_000))).toBe("-0.5");
  });

  it("rejects malformed amounts", () => {
    for (const bad of ["1.23456789", "-1", "1e3", "abc", ""]) expect(() => toStroops(bad)).toThrow();
  });

  it("reserves one base reserve per claimant, two claimants per balance", () => {
    expect(fromStroops(claimableBalanceReserve(300, BigInt(5_000_000)))).toBe("300");
  });
});
