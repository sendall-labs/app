import { describe, expect, it } from "vitest";
import { Networks } from "@stellar/stellar-sdk";
import { networkFromPassphrase, networkMismatch } from "./networkGuard";

describe("wallet network guard", () => {
  it("maps passphrases", () => {
    expect(networkFromPassphrase(Networks.PUBLIC)).toBe("PUBLIC");
    expect(networkFromPassphrase(Networks.TESTNET)).toBe("TESTNET");
    expect(networkFromPassphrase(Networks.FUTURENET)).toBeNull();
  });

  it("blocks a mismatch in either direction", () => {
    expect(networkMismatch("PUBLIC", Networks.TESTNET)).toMatch(/set to Testnet, but this distribution is on Mainnet/);
    expect(networkMismatch("TESTNET", Networks.PUBLIC)).toMatch(/set to Mainnet, but this distribution is on Testnet/);
    expect(networkMismatch("PUBLIC", Networks.FUTURENET)).toMatch(/another network/);
  });

  it("lets a matching or unreported wallet network through", () => {
    expect(networkMismatch("PUBLIC", Networks.PUBLIC)).toBeNull();
    expect(networkMismatch("TESTNET", Networks.TESTNET)).toBeNull();
    expect(networkMismatch("TESTNET", null)).toBeNull();
  });
});
