import { describe, it, expect, beforeAll } from "vitest";
import { Keypair, TransactionBuilder } from "@stellar/stellar-sdk";
import { buildLoginChallenge, verifyLoginChallenge } from "./siws";

describe("SEP-10 style SIWS challenge", () => {
  const serverKeypair = Keypair.random();
  const clientKeypair = Keypair.random();

  beforeAll(() => {
    process.env.SEP10_SERVER_SECRET = serverKeypair.secret();
    process.env.NEXT_PUBLIC_HOME_DOMAIN = "multisend.test";
  });

  it("round-trips: build -> client signs -> verify returns client public key", () => {
    const challenge = buildLoginChallenge(clientKeypair.publicKey(), "TESTNET");

    const tx = TransactionBuilder.fromXDR(challenge, "Test SDF Network ; September 2015");
    tx.sign(clientKeypair);
    const signed = tx.toEnvelope().toXDR("base64");

    const verifiedPublicKey = verifyLoginChallenge(signed, "TESTNET");
    expect(verifiedPublicKey).toBe(clientKeypair.publicKey());
  });

  it("rejects a challenge signed by the wrong key", () => {
    const wrongKeypair = Keypair.random();
    const challenge = buildLoginChallenge(clientKeypair.publicKey(), "TESTNET");

    const tx = TransactionBuilder.fromXDR(challenge, "Test SDF Network ; September 2015");
    tx.sign(wrongKeypair);
    const signed = tx.toEnvelope().toXDR("base64");

    expect(() => verifyLoginChallenge(signed, "TESTNET")).toThrow();
  });

  it("rejects an unsigned challenge", () => {
    const challenge = buildLoginChallenge(clientKeypair.publicKey(), "TESTNET");
    expect(() => verifyLoginChallenge(challenge, "TESTNET")).toThrow();
  });
});
