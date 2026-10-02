import { describe, expect, it } from "vitest";
import { Keypair, Networks, StrKey, TransactionBuilder, type Transaction } from "@stellar/stellar-sdk";
import { buildSetup } from "./buildSetup";

const sponsor = Keypair.random();
const sender = Keypair.random().publicKey();
const hashes = ["aa".repeat(32), "bb".repeat(32), "cc".repeat(32)];
const maxTime = new Date("2030-01-01T00:05:00Z");

function build(overrides: Partial<Parameters<typeof buildSetup>[0]> = {}) {
  return buildSetup({
    network: "TESTNET",
    sourceAccount: sender,
    sourceSequence: "41",
    sponsor,
    chunkHashes: hashes,
    preAuthWeight: 2,
    maxTime,
    ...overrides,
  });
}

describe("buildSetup", () => {
  it("wraps the signer additions in a sponsorship sandwich", () => {
    const setup = build();
    const tx = TransactionBuilder.fromXDR(setup.xdr, Networks.TESTNET) as Transaction;
    expect(tx.source).toBe(sender);
    expect(tx.sequence).toBe("42");
    expect(setup.sequence).toBe("42");
    expect(tx.timeBounds?.maxTime).toBe(String(maxTime.getTime() / 1000));

    const ops = tx.operations;
    expect(ops).toHaveLength(hashes.length + 2);
    expect(ops[0]).toMatchObject({ type: "beginSponsoringFutureReserves", source: sponsor.publicKey(), sponsoredId: sender });
    expect(ops.at(-1)).toMatchObject({ type: "endSponsoringFutureReserves", source: sender });
    ops.slice(1, -1).forEach((op, i) => {
      if (op.type !== "setOptions") throw new Error("expected setOptions");
      expect(op.source).toBe(sender);
      const signer = op.signer as { preAuthTx: Buffer; weight: number };
      expect(signer.weight).toBe(2);
      expect(signer.preAuthTx.toString("hex")).toBe(hashes[i]);
      expect(StrKey.encodePreAuthTx(signer.preAuthTx)).toMatch(/^T/);
    });
  });

  it("is signed by the sponsor only", () => {
    const setup = build();
    const tx = TransactionBuilder.fromXDR(setup.xdr, Networks.TESTNET) as Transaction;
    expect(tx.signatures).toHaveLength(1);
    expect(sponsor.verify(tx.hash(), tx.signatures[0].signature())).toBe(true);
    expect(setup.hash).toBe(tx.hash().toString("hex"));
  });

  it("rejects bad input", () => {
    expect(() => build({ chunkHashes: [] })).toThrow();
    expect(() => build({ chunkHashes: [hashes[0], hashes[0]] })).toThrow(/Duplicate/);
    expect(() => build({ preAuthWeight: 0 })).toThrow(/weight/);
    expect(() => build({ preAuthWeight: 256 })).toThrow(/weight/);
  });
});
