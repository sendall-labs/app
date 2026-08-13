import { describe, it, expect, beforeAll } from "vitest";
import { Account, Keypair } from "@stellar/stellar-sdk";
import { checkRecipients } from "./balanceCheck";
import { buildPaymentChunks } from "./txBuilder";
import { submitAndPoll } from "./submit";
import { getRpcServer, getNetworkPassphrase } from "./client";

// Full engine round-trip against real Testnet: check -> build -> sign ->
// submit -> poll -> decode. This is the concrete on-chain evidence the
// SOW asks for (real tx hash, real balance movement).
describe.skipIf(!!process.env.CI)("MultiSend engine (Testnet e2e)", () => {
  const source = Keypair.random();
  const destA = Keypair.random();
  const destB = Keypair.random(); // left unfunded: exercises createAccount path

  beforeAll(async () => {
    const fund = async (pk: string) => {
      const res = await fetch(`https://friendbot.stellar.org/?addr=${pk}`);
      if (!res.ok) throw new Error(`friendbot funding failed for ${pk}: ${res.status}`);
    };
    await fund(source.publicKey());
    await fund(destA.publicKey());
  }, 20000);

  it("checks, builds, signs, submits, and confirms a real batch of 2 native XLM payments", async () => {
    const targets = [
      { destination: destA.publicKey(), amount: "5" },
      { destination: destB.publicKey(), amount: "3" },
    ];

    const checks = await checkRecipients("TESTNET", targets, null);
    expect(checks.get(destA.publicKey())?.ok).toBe(true);
    expect(checks.get(destB.publicKey())?.needsCreateAccount).toBe(true);
    expect(checks.get(destB.publicKey())?.ok).toBe(true);

    const server = getRpcServer("TESTNET");
    const account: Account = await server.getAccount(source.publicKey());

    const chunks = buildPaymentChunks({
      network: "TESTNET",
      sourceAccount: account,
      asset: null,
      recipients: [
        {
          recipientId: destA.publicKey(),
          destination: destA.publicKey(),
          amount: "5",
          needsCreateAccount: checks.get(destA.publicKey())!.needsCreateAccount,
        },
        {
          recipientId: destB.publicKey(),
          destination: destB.publicKey(),
          amount: "3",
          needsCreateAccount: checks.get(destB.publicKey())!.needsCreateAccount,
        },
      ],
    });
    expect(chunks).toHaveLength(1);

    const { TransactionBuilder } = await import("@stellar/stellar-sdk");
    const tx = TransactionBuilder.fromXDR(chunks[0].xdr, getNetworkPassphrase("TESTNET"));
    tx.sign(source);
    const signedXdr = tx.toEnvelope().toXDR("base64");

    const result = await submitAndPoll("TESTNET", signedXdr);

    expect(result.status).toBe("SUCCESS");
    expect(result.hash).toMatch(/^[0-9a-f]{64}$/);
    expect(result.perOperation).toEqual([
      { operationIndex: 0, success: true, code: "paymentSuccess" },
      { operationIndex: 1, success: true, code: "createAccountSuccess" },
    ]);

    // Confirm actual on-chain balance movement, not just the result code.
    const postCheck = await checkRecipients(
      "TESTNET",
      [{ destination: destB.publicKey(), amount: "0" }],
      null
    );
    expect(postCheck.get(destB.publicKey())?.accountExists).toBe(true);
  }, 60000);

  it("decodes a real on-chain failure (payment to an account without a trustline)", async () => {
    const { Asset } = await import("@stellar/stellar-sdk");
    const issuer = Keypair.random();
    const asset = new Asset("MSTEST", issuer.publicKey());

    const server = getRpcServer("TESTNET");
    const account: Account = await server.getAccount(source.publicKey());

    const chunks = buildPaymentChunks({
      network: "TESTNET",
      sourceAccount: account,
      asset,
      recipients: [
        { recipientId: destA.publicKey(), destination: destA.publicKey(), amount: "1", needsCreateAccount: false },
      ],
    });

    const { TransactionBuilder } = await import("@stellar/stellar-sdk");
    const tx = TransactionBuilder.fromXDR(chunks[0].xdr, getNetworkPassphrase("TESTNET"));
    tx.sign(source);
    const signedXdr = tx.toEnvelope().toXDR("base64");

    const result = await submitAndPoll("TESTNET", signedXdr);

    expect(result.status).toBe("FAILED");
    expect(result.perOperation).toEqual([
      { operationIndex: 0, success: false, code: "paymentNoTrust" },
    ]);
  }, 60000);
});
