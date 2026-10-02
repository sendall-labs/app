import { describe, expect, it } from "vitest";
import { Account, FeeBumpTransaction, Keypair, Networks, Operation, Asset, TransactionBuilder, xdr } from "@stellar/stellar-sdk";
import { buildFeeBump, describeResult } from "./feeBump";

const sponsor = Keypair.random();
const user = Keypair.random();

function inner() {
  const tx = new TransactionBuilder(new Account(user.publicKey(), "5"), { fee: "100", networkPassphrase: Networks.TESTNET })
    .addOperation(Operation.payment({ destination: sponsor.publicKey(), asset: Asset.native(), amount: "1" }))
    .addOperation(Operation.payment({ destination: sponsor.publicKey(), asset: Asset.native(), amount: "2" }))
    .setTimeout(60)
    .build();
  tx.sign(user);
  return tx;
}

describe("buildFeeBump", () => {
  it("wraps the inner tx with the sponsor as fee source and signer", () => {
    const tx = inner();
    const bump = buildFeeBump({ network: "TESTNET", sponsor, innerXdr: tx.toXDR(), feePerOp: "500" });
    const parsed = TransactionBuilder.fromXDR(bump.xdr, Networks.TESTNET) as FeeBumpTransaction;
    expect(parsed).toBeInstanceOf(FeeBumpTransaction);
    expect(parsed.feeSource).toBe(sponsor.publicKey());
    expect(parsed.fee).toBe(String(500 * 3)); // (2 ops + 1) x rate
    expect(parsed.innerTransaction.hash().equals(tx.hash())).toBe(true);
    expect(bump.innerHash).toBe(tx.hash().toString("hex"));
    expect(sponsor.verify(parsed.hash(), parsed.signatures[0].signature())).toBe(true);
    expect(parsed.innerTransaction.signatures).toHaveLength(1);
  });

  it("refuses to bump a fee bump", () => {
    const once = buildFeeBump({ network: "TESTNET", sponsor, innerXdr: inner().toXDR(), feePerOp: "200" });
    expect(() => buildFeeBump({ network: "TESTNET", sponsor, innerXdr: once.xdr, feePerOp: "200" })).toThrow(/already a fee bump/);
  });
});

describe("describeResult", () => {
  it("reads tx-level codes without op results", () => {
    const result = xdr.TransactionResult.fromXDR(
      new xdr.TransactionResult({
        feeCharged: xdr.Int64.fromString("100"),
        result: xdr.TransactionResultResult.txBadSeq(),
        ext: new xdr.TransactionResultExt(0),
      }).toXDR()
    );
    expect(describeResult(result)).toEqual({ txCode: "txBadSeq", perOperation: [] });
  });
});
