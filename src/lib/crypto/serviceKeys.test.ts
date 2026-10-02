import { describe, expect, it } from "vitest";
import { Keypair } from "@stellar/stellar-sdk";
import { decryptSecret, encryptSecret, generateEncryptionKey } from "./serviceKeys";

describe("service key encryption", () => {
  const key = generateEncryptionKey();
  const secret = Keypair.random().secret();

  it("round-trips a secret", () => {
    const enc = encryptSecret(secret, key);
    expect(enc.startsWith("v1:")).toBe(true);
    expect(enc).not.toContain(secret);
    expect(decryptSecret(enc, key)).toBe(secret);
  });

  it("uses a fresh IV every time", () => {
    expect(encryptSecret(secret, key)).not.toBe(encryptSecret(secret, key));
  });

  it("rejects a wrong key", () => {
    const enc = encryptSecret(secret, key);
    expect(() => decryptSecret(enc, generateEncryptionKey())).toThrow();
  });

  it("rejects tampered ciphertext", () => {
    const [v, iv, tag, ct] = encryptSecret(secret, key).split(":");
    const flipped = Buffer.from(ct, "base64");
    flipped[0] ^= 1;
    expect(() => decryptSecret([v, iv, tag, flipped.toString("base64")].join(":"), key)).toThrow();
  });

  it("rejects a missing or short key", () => {
    expect(() => encryptSecret(secret, "")).toThrow(/not set/);
    expect(() => encryptSecret(secret, Buffer.alloc(16).toString("base64"))).toThrow(/32 bytes/);
  });
});
