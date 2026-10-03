import { describe, expect, it } from "vitest";
import { formatAmount, sumAmounts } from "./format";
import { explorerAccountUrl, explorerTxUrl } from "./stellar/explorer";
import { KNOWN_ASSETS, findKnownAsset, issuerForNetwork } from "./stellar/assets";

describe("shared helpers", () => {
  it("formats amounts period-decimal with up to 7 fraction digits", () => {
    expect(formatAmount(1234.5)).toBe("1,234.5");
    expect(formatAmount(0.12345678)).toBe("0.1234568");
  });

  it("sums amounts and ignores non-numeric rows", () => {
    expect(sumAmounts([{ amount: "1.5" }, { amount: "abc" }, { amount: "2" }])).toBe(3.5);
  });

  it("builds explorer links per network", () => {
    expect(explorerTxUrl("TESTNET", "abc")).toBe("https://stellar.expert/explorer/testnet/tx/abc");
    expect(explorerAccountUrl("PUBLIC", "GABC")).toBe("https://stellar.expert/explorer/public/account/GABC");
  });

  it("resolves known assets and their per-network issuers", () => {
    const usdc = findKnownAsset(" usdc ");
    expect(usdc?.code).toBe("USDC");
    expect(issuerForNetwork(usdc!, "TESTNET")).toMatch(/^G[A-Z2-7]{55}$/);
    expect(issuerForNetwork(findKnownAsset("AQUA")!, "TESTNET")).toBeUndefined();
    expect(KNOWN_ASSETS[0].issuer).toBeNull();
  });
});
