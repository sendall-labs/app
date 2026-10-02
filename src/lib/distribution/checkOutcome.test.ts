import { describe, expect, it } from "vitest";
import { checkOutcome } from "./checkOutcome";
import { isConvertible, MOVED_NOTE } from "./convertRules";

const base = { destination: "G", accountExists: true, currentBalance: "1", hasTrustline: true, trustlineLimitOk: true, needsCreateAccount: false, ok: true };

describe("checkOutcome", () => {
  it("keeps payment rules unchanged", () => {
    expect(checkOutcome("PAYMENT", base, false)).toEqual({ ok: true, message: null });
    expect(checkOutcome("PAYMENT", { ...base, hasTrustline: false, ok: false, reason: "No trustline for this asset" }, false)).toEqual({
      ok: false,
      message: "No trustline for this asset",
    });
  });

  it("lets claimable balances through with notes instead of failures", () => {
    expect(checkOutcome("CLAIMABLE_BALANCE", { ...base, accountExists: false, hasTrustline: false, ok: false }, false)).toMatchObject({
      ok: true,
      message: expect.stringMatching(/No account yet/),
    });
    expect(checkOutcome("CLAIMABLE_BALANCE", { ...base, hasTrustline: false, ok: false }, false)).toMatchObject({
      ok: true,
      message: expect.stringMatching(/No trustline yet/),
    });
    expect(checkOutcome("CLAIMABLE_BALANCE", { ...base, ok: false, reason: "Trustline is not authorized by the asset issuer" }, false)).toMatchObject({
      ok: true,
      message: expect.stringMatching(/not authorized yet/),
    });
    // XLM: any amount, even to an account that does not exist yet.
    expect(checkOutcome("CLAIMABLE_BALANCE", { ...base, accountExists: false, ok: false, reason: "New account needs >= 1 XLM" }, true).ok).toBe(true);
    expect(checkOutcome("CLAIMABLE_BALANCE", undefined, true).ok).toBe(false);
  });
});

describe("isConvertible", () => {
  const row = { status: "CHECK_FAILED", hasTrustline: false, accountExists: true, errorMessage: "No trustline for this asset" };
  it("picks rows a claimable balance would fix", () => {
    expect(isConvertible(row, false)).toBe(true);
    expect(isConvertible({ ...row, hasTrustline: null, accountExists: false }, false)).toBe(true);
    expect(isConvertible({ ...row, status: "FAILED", hasTrustline: true, lastResultCode: "paymentNoTrust" }, false)).toBe(true);
  });
  it("skips everything else", () => {
    expect(isConvertible({ ...row, status: "READY" }, false)).toBe(false);
    expect(isConvertible({ ...row, status: "SUCCESS" }, false)).toBe(false);
    expect(isConvertible({ ...row, hasTrustline: true, accountExists: true }, false)).toBe(false);
    expect(isConvertible({ ...row, errorMessage: MOVED_NOTE }, false)).toBe(false);
    expect(isConvertible({ ...row, accountExists: false }, true)).toBe(false); // XLM goes as account creation
  });
});
