import { describe, it, expect, beforeAll } from "vitest";
import { Asset, Keypair } from "@stellar/stellar-sdk";
import { checkRecipients } from "./balanceCheck";

// Hits real Stellar Testnet (Friendbot + RPC). Slow and network-dependent
// by design — this is the integration proof that getLedgerEntries-based
// checks match real on-chain state, per the SOW's evidence requirement.
describe.skipIf(!!process.env.CI)("checkRecipients (Testnet integration)", () => {
  const funded = Keypair.random();
  const unfunded = Keypair.random();

  beforeAll(async () => {
    const res = await fetch(`https://friendbot.stellar.org/?addr=${funded.publicKey()}`);
    if (!res.ok) throw new Error(`friendbot funding failed: ${res.status}`);
  }, 20000);

  it("finds an existing account as ok for native XLM", async () => {
    const results = await checkRecipients(
      "TESTNET",
      [{ destination: funded.publicKey(), amount: "5" }],
      null
    );
    const r = results.get(funded.publicKey())!;
    expect(r.accountExists).toBe(true);
    expect(r.needsCreateAccount).toBe(false);
    expect(r.ok).toBe(true);
  }, 15000);

  it("flags a non-existent account needing >=1 XLM as ok (createAccount path)", async () => {
    const results = await checkRecipients(
      "TESTNET",
      [{ destination: unfunded.publicKey(), amount: "2" }],
      null
    );
    const r = results.get(unfunded.publicKey())!;
    expect(r.accountExists).toBe(false);
    expect(r.needsCreateAccount).toBe(true);
    expect(r.ok).toBe(true);
  }, 15000);

  it("rejects a non-existent account funded with less than the base reserve", async () => {
    const other = Keypair.random();
    const results = await checkRecipients(
      "TESTNET",
      [{ destination: other.publicKey(), amount: "0.5" }],
      null
    );
    const r = results.get(other.publicKey())!;
    expect(r.ok).toBe(false);
  }, 15000);

  it("reports no trustline for an issued asset on a funded account without one", async () => {
    const issuer = Keypair.random();
    const asset = new Asset("MSTEST", issuer.publicKey());
    const results = await checkRecipients(
      "TESTNET",
      [{ destination: funded.publicKey(), amount: "1" }],
      asset
    );
    const r = results.get(funded.publicKey())!;
    expect(r.accountExists).toBe(true);
    expect(r.hasTrustline).toBe(false);
    expect(r.ok).toBe(false);
  }, 15000);

  it("batches multiple recipients into a single check", async () => {
    const results = await checkRecipients(
      "TESTNET",
      [
        { destination: funded.publicKey(), amount: "1" },
        { destination: unfunded.publicKey(), amount: "3" },
      ],
      null
    );
    expect(results.size).toBe(2);
  }, 15000);
});
