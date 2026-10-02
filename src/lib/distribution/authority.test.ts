import { describe, expect, it } from "vitest";
import { Keypair } from "@stellar/stellar-sdk";
import { authorityFromHorizon, MAX_ADDITIONAL_SIGNERS, planAuthority, type AccountAuthority } from "./authority";
import { DistributionError } from "./errors";

const id = Keypair.random().publicKey();

function account(overrides: Partial<AccountAuthority> = {}): AccountAuthority {
  return {
    accountId: id,
    thresholds: { low: 0, medium: 0, high: 0 },
    masterWeight: 1,
    additionalSigners: [],
    ...overrides,
  };
}

function signers(n: number) {
  return Array.from({ length: n }, () => ({ key: Keypair.random().publicKey(), weight: 1, type: "ed25519_public_key" }));
}

function codeOf(fn: () => unknown): string | undefined {
  try {
    fn();
  } catch (err) {
    return err instanceof DistributionError ? err.code : "OTHER";
  }
  return undefined;
}

describe("planAuthority", () => {
  it("default account: all slots free, weight 1", () => {
    const plan = planAuthority(account(), 10);
    expect(plan).toEqual({ freeSignerSlots: 20, preAuthWeight: 1, walletWeight: 1 });
  });

  it("uses the medium threshold as the preAuth weight", () => {
    const plan = planAuthority(account({ masterWeight: 5, thresholds: { low: 1, medium: 3, high: 5 } }), 3);
    expect(plan.preAuthWeight).toBe(3);
  });

  it("allows exactly the remaining slots and rejects one more", () => {
    const a = account({ additionalSigners: signers(10) });
    expect(planAuthority(a, 10).freeSignerSlots).toBe(10);
    expect(codeOf(() => planAuthority(a, 11))).toBe("INSUFFICIENT_SIGNER_SLOTS");
  });

  it("rejects a full signer list", () => {
    expect(codeOf(() => planAuthority(account({ additionalSigners: signers(MAX_ADDITIONAL_SIGNERS) }), 1))).toBe(
      "INSUFFICIENT_SIGNER_SLOTS"
    );
  });

  it("rejects when one wallet signature cannot meet the high threshold", () => {
    const a = account({ masterWeight: 1, thresholds: { low: 1, medium: 1, high: 2 }, additionalSigners: signers(1) });
    expect(codeOf(() => planAuthority(a, 1))).toBe("UNSUPPORTED_MULTISIG");
  });

  it("rejects a locked master key", () => {
    expect(codeOf(() => planAuthority(account({ masterWeight: 0 }), 1))).toBe("UNSUPPORTED_MULTISIG");
  });

  it("accepts a wallet key that is an additional signer with enough weight", () => {
    const wallet = Keypair.random().publicKey();
    const a = account({
      masterWeight: 0,
      thresholds: { low: 2, medium: 2, high: 2 },
      additionalSigners: [{ key: wallet, weight: 2, type: "ed25519_public_key" }],
    });
    expect(planAuthority(a, 1, wallet)).toMatchObject({ preAuthWeight: 2, walletWeight: 2, freeSignerSlots: 19 });
  });
});

describe("authorityFromHorizon", () => {
  it("separates the master key from additional signers", () => {
    const other = Keypair.random().publicKey();
    const a = authorityFromHorizon({
      account_id: id,
      thresholds: { low_threshold: 1, med_threshold: 2, high_threshold: 3 },
      signers: [
        { key: other, weight: 1, type: "ed25519_public_key" },
        { key: id, weight: 3, type: "ed25519_public_key" },
      ],
    } as never);
    expect(a.masterWeight).toBe(3);
    expect(a.additionalSigners.map((s) => s.key)).toEqual([other]);
    expect(a.thresholds).toEqual({ low: 1, medium: 2, high: 3 });
  });
});
