import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

// Channel account secrets live in the database, so they are stored
// encrypted (AES-256-GCM) under a key that only exists in the server
// environment. A database dump alone never yields a usable Stellar key.
//
// Format: "v1:<iv b64>:<auth tag b64>:<ciphertext b64>". The version
// prefix leaves room to rotate the scheme without guessing.

const VERSION = "v1";
const IV_BYTES = 12;

function loadKey(raw = process.env.SERVICE_KEY_ENCRYPTION_KEY): Buffer {
  if (!raw) {
    throw new Error("SERVICE_KEY_ENCRYPTION_KEY is not set. Generate one with: openssl rand -base64 32");
  }
  const key = Buffer.from(raw, "base64");
  if (key.length !== 32) {
    throw new Error("SERVICE_KEY_ENCRYPTION_KEY must be 32 bytes, base64 encoded.");
  }
  return key;
}

export function encryptSecret(plaintext: string, rawKey?: string): string {
  const key = loadKey(rawKey);
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const ciphertext = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return [VERSION, iv.toString("base64"), tag.toString("base64"), ciphertext.toString("base64")].join(":");
}

export function decryptSecret(payload: string, rawKey?: string): string {
  const [version, ivB64, tagB64, ctB64] = payload.split(":");
  if (version !== VERSION || !ivB64 || !tagB64 || !ctB64) {
    throw new Error("Unrecognized encrypted secret format.");
  }
  const key = loadKey(rawKey);
  const decipher = createDecipheriv("aes-256-gcm", key, Buffer.from(ivB64, "base64"));
  decipher.setAuthTag(Buffer.from(tagB64, "base64"));
  return Buffer.concat([decipher.update(Buffer.from(ctB64, "base64")), decipher.final()]).toString("utf8");
}

export function generateEncryptionKey(): string {
  return randomBytes(32).toString("base64");
}
