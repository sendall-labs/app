import { describe, expect, it } from "vitest";
import { Account, Asset, Keypair, Operation, TransactionBuilder } from "@stellar/stellar-sdk";
import { getHorizonServer, getNetworkPassphrase, getRpcServer, NETWORK_CONFIG } from "@/lib/stellar/client";
import { getSponsorKeypair } from "@/lib/stellar/serviceAccounts";
import { buildFeeBump, feeRatePerOp, submitPersisted } from "./feeBump";

const network = "TESTNET" as const;

async function funded() {
  const kp = Keypair.random();
  expect((await fetch(`${NETWORK_CONFIG.TESTNET.friendbot}?addr=${kp.publicKey()}`)).ok).toBe(true);
  return kp;
}

async function nativeBalance(publicKey: string) {
  const acc = await getHorizonServer(network).loadAccount(publicKey);
  return acc.balances.find((b) => b.asset_type === "native")!.balance;
}

async function signedPayment(from: Keypair, destination: string, seqOffset = 0) {
  const current = (await getRpcServer(network).getAccount(from.publicKey())).sequenceNumber();
  const seq = (BigInt(current) + BigInt(seqOffset)).toString();
  const tx = new TransactionBuilder(new Account(from.publicKey(), seq), { fee: "100", networkPassphrase: getNetworkPassphrase(network) })
    .addOperation(Operation.payment({ destination, asset: Asset.native(), amount: "1" }))
    .setTimeout(120)
    .build();
  tx.sign(from);
  return tx.toXDR();
}

describe.skipIf(!!process.env.CI)("fee bump submission (Testnet)", () => {
  const sponsor = getSponsorKeypair(network);

  it("bids a sane per-op fee", async () => {
    expect(Number(await feeRatePerOp(network))).toBeGreaterThanOrEqual(100);
  });

  it("lets the sponsor pay, and a resubmit finds the landed tx instead of sending twice", async () => {
    const user = await funded();
    const before = await nativeBalance(user.publicKey());
    const bump = buildFeeBump({ network, sponsor, innerXdr: await signedPayment(user, sponsor.publicKey()), feePerOp: await feeRatePerOp(network) });

    const first = await submitPersisted(network, bump.xdr);
    expect(first).toMatchObject({ status: "SUCCESS", hash: bump.hash, txCode: "txSuccess" });
    expect(Number(before) - Number(await nativeBalance(user.publicKey()))).toBe(1); // no fee charged to the user

    const again = await submitPersisted(network, bump.xdr);
    expect(again).toMatchObject({ status: "SUCCESS", hash: bump.hash, ledger: first.ledger });
  }, 120_000);

  it("reports an applied failure with the inner op code", async () => {
    const user = await funded();
    const bump = buildFeeBump({ network, sponsor, innerXdr: await signedPayment(user, Keypair.random().publicKey()), feePerOp: "100" });
    const out = await submitPersisted(network, bump.xdr);
    expect(out.status).toBe("FAILED");
    expect(out.txCode).toBe("txFailed");
    expect(out.perOperation).toEqual([{ operationIndex: 0, success: false, code: "paymentNoDestination" }]);
  }, 120_000);

  it("reports a rejection that never reached the ledger", async () => {
    const user = await funded();
    const bump = buildFeeBump({ network, sponsor, innerXdr: await signedPayment(user, sponsor.publicKey(), 5), feePerOp: "100" });
    const out = await submitPersisted(network, bump.xdr);
    expect(out.status).toBe("REJECTED");
    expect(out.txCode).toBe("txBadSeq");
  }, 120_000);
});
