import { describe, it, expect } from "vitest";
import { Account, Asset, Keypair, Operation, Transaction, TransactionBuilder } from "@stellar/stellar-sdk";
import { buildPaymentChunks, MAX_OPS_PER_TX } from "./txBuilder";

const PASSPHRASE = "Test SDF Network ; September 2015";

function randomRecipients(count: number) {
  return Array.from({ length: count }, (_, i) => ({
    recipientId: `r${i}`,
    destination: Keypair.random().publicKey(),
    amount: "10",
    needsCreateAccount: false,
  }));
}

describe("buildPaymentChunks", () => {
  it("puts everything in one chunk when <= 100 recipients", () => {
    const source = new Account(Keypair.random().publicKey(), "100");
    const chunks = buildPaymentChunks({
      network: "TESTNET",
      sourceAccount: source,
      asset: null,
      recipients: randomRecipients(3),
    });
    expect(chunks).toHaveLength(1);
    expect(chunks[0].operationCount).toBe(3);
    expect(chunks[0].requiresSignature).toBe(true);
  });

  it("splits exactly at the 100-operation boundary", () => {
    const source = new Account(Keypair.random().publicKey(), "100");
    const chunks = buildPaymentChunks({
      network: "TESTNET",
      sourceAccount: source,
      asset: null,
      recipients: randomRecipients(MAX_OPS_PER_TX),
    });
    expect(chunks).toHaveLength(1);
    expect(chunks[0].operationCount).toBe(MAX_OPS_PER_TX);
  });

  it("splits 101 recipients into two chunks, reserving one op in the first for the preAuthTx chain", () => {
    const source = new Account(Keypair.random().publicKey(), "100");
    const chunks = buildPaymentChunks({
      network: "TESTNET",
      sourceAccount: source,
      asset: null,
      recipients: randomRecipients(MAX_OPS_PER_TX + 1),
    });
    expect(chunks).toHaveLength(2);
    // 99 payments + 1 reserved slot for the chaining SetOptions op.
    expect(chunks[0].operationCount).toBe(99);
    expect(chunks[1].operationCount).toBe(2);
  });

  it("only the first chunk of a multi-chunk batch requires a signature", () => {
    const source = new Account(Keypair.random().publicKey(), "100");
    const chunks = buildPaymentChunks({
      network: "TESTNET",
      sourceAccount: source,
      asset: null,
      recipients: randomRecipients(120),
    });
    expect(chunks).toHaveLength(2);
    expect(chunks[0].requiresSignature).toBe(true);
    expect(chunks[1].requiresSignature).toBe(false);
  });

  it("chains chunks via a preAuthTx signer whose hash matches the next chunk's transaction hash", () => {
    const source = new Account(Keypair.random().publicKey(), "100");
    const chunks = buildPaymentChunks({
      network: "TESTNET",
      sourceAccount: source,
      asset: null,
      recipients: randomRecipients(120),
    });
    const firstTx = TransactionBuilder.fromXDR(chunks[0].xdr, PASSPHRASE) as Transaction;
    const secondTx = TransactionBuilder.fromXDR(chunks[1].xdr, PASSPHRASE) as Transaction;

    const setOptionsOp = firstTx.operations[firstTx.operations.length - 1];
    expect(setOptionsOp.type).toBe("setOptions");
    const signer = (setOptionsOp as Operation.SetOptions).signer;
    if (!signer || !("preAuthTx" in signer)) throw new Error("expected a preAuthTx signer");
    expect(signer.preAuthTx.toString("hex")).toBe(secondTx.hash().toString("hex"));
    expect(signer.weight).toBe(1);

    // The last chunk has no chaining op — every operation is a real payment.
    expect(secondTx.operations.every((op) => op.type === "payment")).toBe(true);
  });

  it("assigns strictly increasing sequence numbers across chunks, one per tx", () => {
    const source = new Account(Keypair.random().publicKey(), "1000");
    const chunks = buildPaymentChunks({
      network: "TESTNET",
      sourceAccount: source,
      asset: null,
      recipients: randomRecipients(150),
    });
    const seqNums = chunks.map(
      (c) => (TransactionBuilder.fromXDR(c.xdr, PASSPHRASE) as Transaction).sequence
    );
    expect(seqNums).toEqual(["1001", "1002"]);
  });

  it("uses createAccount for recipients flagged needsCreateAccount, payment otherwise", () => {
    const source = new Account(Keypair.random().publicKey(), "100");
    const recipients = [
      { recipientId: "a", destination: Keypair.random().publicKey(), amount: "5", needsCreateAccount: true },
      { recipientId: "b", destination: Keypair.random().publicKey(), amount: "5", needsCreateAccount: false },
    ];
    const chunks = buildPaymentChunks({
      network: "TESTNET",
      sourceAccount: source,
      asset: null,
      recipients,
    });
    const tx = TransactionBuilder.fromXDR(chunks[0].xdr, PASSPHRASE);
    expect(tx.operations[0].type).toBe("createAccount");
    expect(tx.operations[1].type).toBe("payment");
  });

  it("always uses payment (never createAccount) for issued assets", () => {
    const source = new Account(Keypair.random().publicKey(), "100");
    const issuer = Keypair.random();
    const asset = new Asset("MSTEST", issuer.publicKey());
    const recipients = [
      { recipientId: "a", destination: Keypair.random().publicKey(), amount: "5", needsCreateAccount: true },
    ];
    const chunks = buildPaymentChunks({
      network: "TESTNET",
      sourceAccount: source,
      asset,
      recipients,
    });
    const tx = TransactionBuilder.fromXDR(chunks[0].xdr, PASSPHRASE);
    expect(tx.operations[0].type).toBe("payment");
  });

  it("maps each operation index back to its recipientId in order", () => {
    const source = new Account(Keypair.random().publicKey(), "100");
    const recipients = randomRecipients(5);
    const chunks = buildPaymentChunks({
      network: "TESTNET",
      sourceAccount: source,
      asset: null,
      recipients,
    });
    expect(chunks[0].items).toEqual(
      recipients.map((r, i) => ({ recipientId: r.recipientId, operationIndex: i }))
    );
  });
});
