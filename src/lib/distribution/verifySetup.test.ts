import { describe, expect, it } from "vitest";
import { Keypair, Networks, TransactionBuilder, type Transaction } from "@stellar/stellar-sdk";
import { buildSetup } from "./buildSetup";
import { buildRemoval } from "./cleanup";
import { DistributionError } from "./errors";
import { verifySignedSetup, type ExpectedSetup } from "./verifySetup";

const sponsor = Keypair.random();
const user = Keypair.random();
const hashes = ["11".repeat(32), "22".repeat(32)];
const future = () => new Date(Date.now() + 5 * 60_000);

function setupWith(overrides: Partial<Parameters<typeof buildSetup>[0]> = {}) {
  return buildSetup({
    network: "TESTNET",
    sourceAccount: user.publicKey(),
    sourceSequence: "100",
    sponsor,
    chunkHashes: hashes,
    preAuthWeight: 1,
    maxTime: future(),
    ...overrides,
  });
}

function expectedFor(setup: { xdr: string; hash: string }, overrides: Partial<ExpectedSetup> = {}): ExpectedSetup {
  return {
    network: "TESTNET",
    persistedXdr: setup.xdr,
    persistedHash: setup.hash,
    sourceAccount: user.publicKey(),
    sponsorPublicKey: sponsor.publicKey(),
    chunkHashes: hashes,
    preAuthWeight: 1,
    ...overrides,
  };
}

function signAs(x: string, ...signers: Keypair[]) {
  const tx = TransactionBuilder.fromXDR(x, Networks.TESTNET) as Transaction;
  for (const s of signers) tx.sign(s);
  return tx.toXDR();
}

function code(fn: () => unknown) {
  try {
    fn();
  } catch (err) {
    if (err instanceof DistributionError) return `${err.code}:${(err.details?.reason as string) ?? ""}`;
    throw err;
  }
  return "ok";
}

describe("verifySignedSetup", () => {
  const persisted = setupWith();
  const expected = expectedFor(persisted);

  it("accepts the wallet-signed setup and returns exactly sponsor + sender signatures", () => {
    const stray = Keypair.random();
    const out = verifySignedSetup(expected, signAs(persisted.xdr, user, stray));
    const tx = TransactionBuilder.fromXDR(out, Networks.TESTNET) as Transaction;
    expect(tx.hash().toString("hex")).toBe(persisted.hash);
    expect(tx.signatures).toHaveLength(2);
    expect(sponsor.verify(tx.hash(), tx.signatures[0].signature())).toBe(true);
    expect(user.verify(tx.hash(), tx.signatures[1].signature())).toBe(true);
  });

  it("accepts a wallet that dropped the sponsor signature", () => {
    const tx = TransactionBuilder.fromXDR(persisted.xdr, Networks.TESTNET) as Transaction;
    tx.signatures.length = 0;
    tx.sign(user);
    expect(code(() => verifySignedSetup(expected, tx.toXDR()))).toBe("ok");
  });

  it.each([
    ["signer hash", { chunkHashes: [hashes[0], "33".repeat(32)] }],
    ["signer weight", { preAuthWeight: 2 }],
    ["sponsor", { sponsor: Keypair.random() }],
    ["sequence", { sourceSequence: "101" }],
    ["time bounds", { maxTime: new Date(Date.now() + 9 * 60_000) }],
    ["operation count", { chunkHashes: [hashes[0]] }],
  ])("rejects a tampered %s", (_label, change) => {
    const tampered = setupWith(change as never);
    expect(code(() => verifySignedSetup(expected, signAs(tampered.xdr, user)))).toBe("SETUP_MISMATCH:transaction contents");
  });

  it("rejects the same transaction signed for another network", () => {
    const other = TransactionBuilder.fromXDR(persisted.xdr, Networks.PUBLIC) as Transaction;
    other.sign(user);
    expect(code(() => verifySignedSetup(expected, other.toXDR()))).toBe("SETUP_MISMATCH:missing sender signature");
  });

  it("rejects a missing or foreign sender signature", () => {
    expect(code(() => verifySignedSetup(expected, persisted.xdr))).toBe("SETUP_MISMATCH:missing sender signature");
    expect(code(() => verifySignedSetup(expected, signAs(persisted.xdr, Keypair.random())))).toBe(
      "SETUP_MISMATCH:missing sender signature"
    );
  });

  it("rejects garbage and fee bump envelopes", () => {
    expect(code(() => verifySignedSetup(expected, "not-xdr"))).toBe("SETUP_MISMATCH:unreadable XDR");
    const inner = TransactionBuilder.fromXDR(signAs(persisted.xdr, user), Networks.TESTNET) as Transaction;
    const bump = TransactionBuilder.buildFeeBumpTransaction(sponsor, "1000", inner, Networks.TESTNET);
    expect(code(() => verifySignedSetup(expected, bump.toXDR()))).toBe("SETUP_MISMATCH:fee bump envelope");
  });

  it("rejects an expired approval window", () => {
    const later = new Date(Date.now() + 10 * 60_000);
    expect(code(() => verifySignedSetup(expected, signAs(persisted.xdr, user), later))).toMatch(/^SETUP_EXPIRED/);
  });

  it("refuses a persisted record whose hash or shape is off", () => {
    expect(code(() => verifySignedSetup({ ...expected, persistedHash: "00".repeat(32) }, signAs(persisted.xdr, user)))).toBe(
      "SETUP_MISMATCH:persisted record"
    );
    expect(code(() => verifySignedSetup({ ...expected, preAuthWeight: 3 }, signAs(persisted.xdr, user)))).toBe(
      "SETUP_MISMATCH:signer weight 1"
    );
    expect(code(() => verifySignedSetup({ ...expected, sponsorPublicKey: Keypair.random().publicKey() }, signAs(persisted.xdr, user)))).toBe(
      "SETUP_MISMATCH:sponsorship start"
    );
  });
});

describe("verifySignedSetup (removal)", () => {
  const removal = buildRemoval({ network: "TESTNET", sourceAccount: user.publicKey(), sourceSequence: "7", hashes, maxTime: future() });
  const expected: ExpectedSetup = {
    network: "TESTNET",
    persistedXdr: removal.xdr,
    persistedHash: removal.hash,
    sourceAccount: user.publicKey(),
    sponsorPublicKey: sponsor.publicKey(),
    chunkHashes: hashes,
    preAuthWeight: 0,
    kind: "remove",
  };

  it("accepts a sender-signed removal and keeps only that signature", () => {
    const out = verifySignedSetup(expected, signAs(removal.xdr, user, Keypair.random()));
    const tx = TransactionBuilder.fromXDR(out, Networks.TESTNET) as Transaction;
    expect(tx.signatures).toHaveLength(1);
    expect(user.verify(tx.hash(), tx.signatures[0].signature())).toBe(true);
  });

  it("rejects a removal aimed at other signers", () => {
    expect(code(() => verifySignedSetup({ ...expected, chunkHashes: [hashes[0], "99".repeat(32)] }, signAs(removal.xdr, user)))).toBe(
      "SETUP_MISMATCH:signer hash 2"
    );
  });

  it("rejects an install setup presented as a removal", () => {
    const install = setupWith();
    expect(code(() => verifySignedSetup({ ...expected, persistedXdr: install.xdr, persistedHash: install.hash }, signAs(install.xdr, user)))).toBe(
      "SETUP_MISMATCH:operation count"
    );
  });
});
