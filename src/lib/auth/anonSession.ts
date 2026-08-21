import { SignJWT, jwtVerify } from "jose";

const ANON_COOKIE = "sendall_anon";
// Long-lived: this cookie is what lets a wallet-less visitor come back later
// (different tab, browser restart) and still find their draft batches.
const ANON_TTL_SECONDS = 60 * 60 * 24 * 90; // 90 days

function getSecret(): Uint8Array {
  const secret = process.env.SESSION_SECRET;
  if (!secret) throw new Error("SESSION_SECRET is not set");
  return new TextEncoder().encode(secret);
}

export type AnonPayload = {
  sub: string; // random device/session id, not a Stellar key
};

export async function signAnon(payload: AnonPayload): Promise<string> {
  return new SignJWT(payload)
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime(`${ANON_TTL_SECONDS}s`)
    .sign(getSecret());
}

export async function verifyAnon(token: string): Promise<AnonPayload | null> {
  try {
    const { payload } = await jwtVerify(token, getSecret());
    if (typeof payload.sub !== "string") return null;
    return { sub: payload.sub };
  } catch {
    return null;
  }
}

export { ANON_COOKIE, ANON_TTL_SECONDS };
