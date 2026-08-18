import { describe, it, expect, beforeAll } from "vitest";
import { Keypair } from "@stellar/stellar-sdk";
import { buildLoginMessage, verifyLoginMessage } from "./siws";

describe("SEP-53 login message", () => {
  const clientKeypair = Keypair.random();

  beforeAll(() => {
    process.env.SESSION_SECRET = "test-session-secret";
    process.env.NEXT_PUBLIC_HOME_DOMAIN = "sendall.test";
  });

  it("round-trips: build -> client signs -> verify returns client public key", async () => {
    const { message, token } = await buildLoginMessage(clientKeypair.publicKey());

    const signedMessage = clientKeypair.signMessage(message).toString("base64");

    const verifiedPublicKey = await verifyLoginMessage({
      publicKey: clientKeypair.publicKey(),
      signedMessage,
      token,
    });
    expect(verifiedPublicKey).toBe(clientKeypair.publicKey());
  });

  it("rejects a message signed by the wrong key", async () => {
    const wrongKeypair = Keypair.random();
    const { message, token } = await buildLoginMessage(clientKeypair.publicKey());

    const signedMessage = wrongKeypair.signMessage(message).toString("base64");

    await expect(
      verifyLoginMessage({ publicKey: clientKeypair.publicKey(), signedMessage, token })
    ).rejects.toThrow();
  });

  it("rejects a token issued for a different public key", async () => {
    const otherKeypair = Keypair.random();
    const { message, token } = await buildLoginMessage(otherKeypair.publicKey());

    const signedMessage = clientKeypair.signMessage(message).toString("base64");

    await expect(
      verifyLoginMessage({ publicKey: clientKeypair.publicKey(), signedMessage, token })
    ).rejects.toThrow();
  });

  it("rejects a tampered token", async () => {
    const { message } = await buildLoginMessage(clientKeypair.publicKey());
    const signedMessage = clientKeypair.signMessage(message).toString("base64");

    await expect(
      verifyLoginMessage({
        publicKey: clientKeypair.publicKey(),
        signedMessage,
        token: "not-a-real-token",
      })
    ).rejects.toThrow();
  });
});
