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

  it("splits 101 recipients into a master tx plus two full payment chunks", () => {
    const source = new Account(Keypair.random().publicKey(), "100");
    const chunks = buildPaymentChunks({
      network: "TESTNET",
      sourceAccount: source,
      asset: null,
      recipients: randomRecipients(MAX_OPS_PER_TX + 1),
    });
    expect(chunks).toHaveLength(3);
    // Master tx: one SetOptions op per payment chunk.
    expect(chunks[0].operationCount).toBe(2);
    expect(chunks[0].items).toEqual([]);
    // Payment chunks use the full 100-op budget — nothing reserved.
    expect(chunks[1].operationCount).toBe(100);
    expect(chunks[2].operationCount).toBe(1);
  });

  it("only the master tx of a multi-chunk batch requires a signature", () => {
    const source = new Account(Keypair.random().publicKey(), "100");
    const chunks = buildPaymentChunks({
      network: "TESTNET",
      sourceAccount: source,
      asset: null,
      recipients: randomRecipients(120),
    });
    expect(chunks).toHaveLength(3);
    expect(chunks[0].requiresSignature).toBe(true);
    expect(chunks[1].requiresSignature).toBe(false);
    expect(chunks[2].requiresSignature).toBe(false);
  });

  it("master tx installs a preAuthTx signer per payment chunk, matching each chunk's own hash", () => {
    const source = new Account(Keypair.random().publicKey(), "100");
    const chunks = buildPaymentChunks({
      network: "TESTNET",
      sourceAccount: source,
      asset: null,
      recipients: randomRecipients(220),
    });
    expect(chunks).toHaveLength(4); // master + 3 payment chunks (100 + 100 + 20)

    const masterTx = TransactionBuilder.fromXDR(chunks[0].xdr, PASSPHRASE) as Transaction;
    expect(masterTx.operations).toHaveLength(3);

    chunks.slice(1).forEach((paymentChunk, i) => {
      const paymentTx = TransactionBuilder.fromXDR(paymentChunk.xdr, PASSPHRASE) as Transaction;
      // Every op in a payment chunk is a real payment — no chaining op mixed in.
      expect(paymentTx.operations.every((op) => op.type === "payment")).toBe(true);

      const setOptionsOp = masterTx.operations[i];
      expect(setOptionsOp.type).toBe("setOptions");
      const signer = (setOptionsOp as Operation.SetOptions).signer;
      if (!signer || !("preAuthTx" in signer)) throw new Error("expected a preAuthTx signer");
      expect(signer.preAuthTx.toString("hex")).toBe(paymentTx.hash().toString("hex"));
      expect(signer.weight).toBe(1);
    });
  });

  it("assigns strictly increasing sequence numbers across chunks, master first", () => {
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
    expect(seqNums).toEqual(["1001", "1002", "1003"]);
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
