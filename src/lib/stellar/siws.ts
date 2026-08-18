import { Keypair, MuxedAccount, StrKey } from "@stellar/stellar-sdk";
import { SignJWT, jwtVerify } from "jose";
import { randomBytes } from "node:crypto";

const CHALLENGE_TIMEOUT_SECONDS = 300; // 5 minutes

function getChallengeSecret(): Uint8Array {
  const secret = process.env.SESSION_SECRET;
  if (!secret) throw new Error("SESSION_SECRET is not set");
  return new TextEncoder().encode(secret);
}

function getHomeDomain(): string {
  const domain = process.env.NEXT_PUBLIC_HOME_DOMAIN;
  if (!domain) throw new Error("NEXT_PUBLIC_HOME_DOMAIN is not set");
  return domain;
}

/** Muxed (M...) addresses sign with their underlying base (G...) keypair. */
function baseVerifyingKey(publicKey: string): string {
  return StrKey.isValidMed25519PublicKey(publicKey)
    ? MuxedAccount.fromAddress(publicKey, "0").baseAccount().accountId()
    : publicKey;
}

function buildMessage(params: {
  domain: string;
  publicKey: string;
  nonce: string;
  issuedAt: string;
  expiresAt: string;
}): string {
  return [
    `${params.domain} wants you to sign in with your Stellar account:`,
    params.publicKey,
    ``,
    `Nonce: ${params.nonce}`,
    `Issued At: ${params.issuedAt}`,
    `Expires At: ${params.expiresAt}`,
  ].join("\n");
}

/**
 * Builds a SEP-53 login message for `publicKey`, plus an opaque token (JWT)
 * carrying the same nonce/expiry claims. The client signs the message text
 * with their wallet's SEP-53 "sign message" (not a transaction — no fee, no
 * network submission) and echoes the token back unchanged.
 *
 * verifyLoginMessage re-derives the exact message from the token's claims
 * rather than trusting whatever the client sends back, so the token can't be
 * replayed with a different message, domain, or public key than the one we
 * issued it for.
 */
export async function buildLoginMessage(
  publicKey: string
): Promise<{ message: string; token: string }> {
  const domain = getHomeDomain();
  const nonce = randomBytes(16).toString("hex");
  // JWT iat/exp claims are whole seconds — round here so the message text we
  // sign now matches, byte for byte, the text verifyLoginMessage rebuilds
  // from the token's (second-precision) claims later.
  const issuedAt = new Date(Math.floor(Date.now() / 1000) * 1000);
  const expiresAt = new Date(issuedAt.getTime() + CHALLENGE_TIMEOUT_SECONDS * 1000);

  const message = buildMessage({
    domain,
    publicKey,
    nonce,
    issuedAt: issuedAt.toISOString(),
    expiresAt: expiresAt.toISOString(),
  });

  const token = await new SignJWT({ sub: publicKey, nonce })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt(issuedAt)
    .setExpirationTime(expiresAt)
    .sign(getChallengeSecret());

  return { message, token };
}

/**
 * Verifies a SEP-53-signed login message against the token issued by
 * buildLoginMessage. Throws if the token is expired/tampered, was issued for
 * a different public key, or the signature doesn't match.
 */
export async function verifyLoginMessage(params: {
  publicKey: string;
  signedMessage: string; // base64-encoded 64-byte ed25519 signature
  token: string;
}): Promise<string> {
  const { payload } = await jwtVerify(params.token, getChallengeSecret());
  if (payload.sub !== params.publicKey) {
    throw new Error("Public key does not match the issued challenge");
  }
  if (typeof payload.nonce !== "string" || !payload.iat || !payload.exp) {
    throw new Error("Malformed challenge token");
  }

  const message = buildMessage({
    domain: getHomeDomain(),
    publicKey: params.publicKey,
    nonce: payload.nonce,
    issuedAt: new Date(payload.iat * 1000).toISOString(),
    expiresAt: new Date(payload.exp * 1000).toISOString(),
  });

  const signature = Buffer.from(params.signedMessage, "base64");
  const verified = Keypair.fromPublicKey(baseVerifyingKey(params.publicKey)).verifyMessage(
    message,
    signature
  );
  if (!verified) throw new Error("Signature does not match the claimed public key");

  return params.publicKey;
}
